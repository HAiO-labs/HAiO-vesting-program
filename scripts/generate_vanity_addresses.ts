import { Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

// Vanity address 생성 설정
const TARGET_PREFIXES = {
  PROGRAM: { prefix: 'haio', caseSensitive: false },  // 프로그램 ID용 (대소문자 구분 없음)
  TOKEN: { prefix: 'haio', caseSensitive: true },     // 토큰 민트용 (소문자만)
};

// ==================================================================
// 워커 스레드에서 실행될 로직 (CPU 코어 하나하나가 이 코드를 실행)
// ==================================================================
if (!isMainThread) {
  const { targetConfig, addressType } = workerData;
  const { prefix, caseSensitive } = targetConfig;
  const prefixLength = prefix.length;
  let attempts = 0;

  while (true) {
    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();
    attempts++;
    
    // 100만개마다 진행 상황 로그
    if (attempts % 1000000 === 0) {
      parentPort?.postMessage({
        type: 'progress',
        attempts,
        addressType,
      });
    }
    
    // 주소 체크 로직
    const addressPrefix = address.substring(0, prefixLength);
    const targetPrefix = caseSensitive ? prefix : prefix.toLowerCase();
    const comparePrefix = caseSensitive ? addressPrefix : addressPrefix.toLowerCase();
    
    if (comparePrefix === targetPrefix) {
      // 찾았으면 부모 스레드에 secretKey를 전송하고 종료
      parentPort?.postMessage({
        type: 'found',
        address: address,
        secretKey: keypair.secretKey,
        attempts,
        addressType,
      });
      process.exit(0);
    }
  }
}

// ==================================================================
// 메인 스레드에서 실행될 로직 (워커들을 관리)
// ==================================================================

/**
 * 모든 CPU 코어를 활용하여 Vanity 주소를 생성하는 최적화된 함수
 * @param targetConfig 찾고자 하는 주소 설정 (prefix, caseSensitive)
 * @param addressType 주소 타입 (PROGRAM 또는 TOKEN)
 * @returns 찾은 Keypair 객체
 */
function generateVanityKeypair(targetConfig: { prefix: string, caseSensitive: boolean }, addressType: string): Promise<Keypair> {
  const caseInfo = targetConfig.caseSensitive ? 'case-sensitive' : 'case-insensitive';
  console.log(`🎯 Generating ${addressType} vanity address starting with "${targetConfig.prefix}" (${caseInfo}) using all CPU cores...`);
  
  return new Promise((resolve, reject) => {
    const numCpus = os.cpus().length;
    console.log(`💻 Utilizing ${numCpus} CPU cores for generation.`);
    const workers: Worker[] = [];
    let found = false;
    let totalProgress = 0;

    for (let i = 0; i < numCpus; i++) {
      const worker = new Worker(__filename, {
        workerData: { targetConfig, addressType },
      });

      worker.on('message', (result) => {
        if (result.type === 'progress') {
          totalProgress += 1000000;
          console.log(`⏳ ${result.addressType}: Searched ${totalProgress.toLocaleString()} addresses so far...`);
          return;
        }

        if (result.type === 'found' && !found) {
          found = true;
          
          const keypair = Keypair.fromSecretKey(result.secretKey);
          console.log(`🎉 FOUND ${result.addressType} vanity address!`);
          console.log(`✅ Address: ${result.address}`);
          console.log(`📊 Total attempts: ${result.attempts.toLocaleString()}`);

          // 모든 워커 종료
          workers.forEach(w => w.terminate());
          resolve(keypair);
        }
      });

      worker.on('error', (err) => {
        console.error('A worker encountered an error:', err);
        if (!found) {
          found = true;
          workers.forEach(w => w.terminate());
          reject(err);
        }
      });

      worker.on('exit', (code) => {
        if (code !== 0 && !found) {
          console.error(`Worker stopped with exit code ${code}`);
        }
      });

      workers.push(worker);
    }
  });
}

function saveKeypair(keypair: Keypair, filename: string): void {
  const keypairArray = Array.from(keypair.secretKey);
  const keysDir = path.join(__dirname, '../keys');
  
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }
  
  const filepath = path.join(keysDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(keypairArray));
  console.log(`💾 Keypair saved to: ${filepath}`);
}

async function main() {
  console.log('🚀 HAiO Vanity Address Generator');
  console.log('📋 Target Prefixes:');
  console.log(`   • Program ID: "${TARGET_PREFIXES.PROGRAM.prefix}" (case-insensitive)`);
  console.log(`   • Token Mint: "${TARGET_PREFIXES.TOKEN.prefix}" (case-sensitive, lowercase only)`);
  console.log(`⚠️  This may take a while depending on the prefix length...\n`);

  // 프로그램 ID용 키페어 생성
  console.log('🔧 Generating Program ID vanity address...');
  const programKeypair = await generateVanityKeypair(TARGET_PREFIXES.PROGRAM, 'PROGRAM');
  
  if (programKeypair) {
    saveKeypair(programKeypair, 'haio_vesting_program.json');
    console.log(`🏗️  Program ID: ${programKeypair.publicKey.toBase58()}\n`);
  } else {
    console.log('❌ Failed to generate program vanity address\n');
  }

  // 토큰 민트용 키페어 생성
  console.log('🪙 Generating Token Mint vanity address...');
  const tokenKeypair = await generateVanityKeypair(TARGET_PREFIXES.TOKEN, 'TOKEN');
  
  if (tokenKeypair) {
    saveKeypair(tokenKeypair, 'haio_token_mint.json');
    console.log(`🪙 Token Mint: ${tokenKeypair.publicKey.toBase58()}\n`);
  } else {
    console.log('❌ Failed to generate token vanity address\n');
  }

  // 결과 요약
  console.log('📋 Generation Summary:');
  
  if (programKeypair) {
    console.log('✅ Program ID generated successfully');
    console.log(`   Address: ${programKeypair.publicKey.toBase58()}`);
    console.log(`   File: keys/haio_vesting_program.json`);
  }
  
  if (tokenKeypair) {
    console.log('✅ Token Mint generated successfully');
    console.log(`   Address: ${tokenKeypair.publicKey.toBase58()}`);
    console.log(`   File: keys/haio_token_mint.json`);
  }

  if (programKeypair || tokenKeypair) {
    console.log('\n📋 Next Steps:');
    console.log('1. Update Anchor.toml with new program ID');
    console.log('2. Update lib.rs declare_id! with new program ID');
    console.log('3. Update token creation script to use new mint keypair');
    console.log('4. Rebuild and redeploy the program');
  }

  // 설정 파일 생성
  if (programKeypair && tokenKeypair) {
    const vanityConfig = {
      programId: programKeypair.publicKey.toBase58(),
      tokenMint: tokenKeypair.publicKey.toBase58(),
      generatedAt: new Date().toISOString(),
      targetPrefixes: {
        program: `${TARGET_PREFIXES.PROGRAM.prefix} (case-insensitive)`,
        token: `${TARGET_PREFIXES.TOKEN.prefix} (case-sensitive, lowercase only)`,
      },
    };

    const configPath = path.join(__dirname, '../.haio-vanity-config.json');
    fs.writeFileSync(configPath, JSON.stringify(vanityConfig, null, 2));
    console.log(`📄 Vanity config saved to: ${configPath}`);
  }
}

// 메인 스레드에서만 main() 함수를 실행
if (isMainThread) {
  const startTime = Date.now();
  main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  }).finally(() => {
    const duration = (Date.now() - startTime) / 1000;
    console.log(`⏱️  Total generation time: ${duration.toFixed(2)} seconds`);
  });
}