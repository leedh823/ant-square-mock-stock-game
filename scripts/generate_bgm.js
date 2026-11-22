/**
 * 개미광장(Ant Square) 자체 제작 인스트루멘털 앰비언트 BGM 생성 스크립트
 * - 라이선스/출처: 프로젝트 내 Node.js 오디오 합성 스크립트로 직접 생성한 오리지널 무저작권(CC0) 음원
 * - 구성: 보컬 없는 차분한 로우볼륨 앰비언트 패드 + 부드러운 일렉트릭 피아노 톤 (16초 심리스 루프, 22050Hz 16-bit PCM WAV)
 */
const fs = require('node:fs');
const path = require('node:path');

const SAMPLE_RATE = 22050;
const DURATION_SEC = 16;
const NUM_SAMPLES = SAMPLE_RATE * DURATION_SEC;

// 차분한 집중용 코드 진행 (Cmaj9 -> Am9 -> Fmaj9 -> G6), 각 4초
const CHORDS = [
  [261.63, 329.63, 392.00, 493.88, 587.33], // Cmaj9
  [220.00, 261.63, 329.63, 392.00, 493.88], // Am9
  [174.61, 220.00, 261.63, 329.63, 392.00], // Fmaj9
  [196.00, 246.94, 293.66, 329.63, 392.00]  // G6
];

// 부드러운 펜타토닉 아르페지오 노트 (각 1초 간격)
const ARP_NOTES = [
  523.25, 659.25, 587.33, 493.88,
  440.00, 523.25, 493.88, 392.00,
  349.23, 440.00, 523.25, 440.00,
  392.00, 493.88, 587.33, 493.88
];

const pcm = new Float32Array(NUM_SAMPLES);

for (let i = 0; i < NUM_SAMPLES; i++) {
  const t = i / SAMPLE_RATE;
  const chordIdx = Math.floor(t / 4) % CHORDS.length;
  const localChordT = t % 4;
  const chord = CHORDS[chordIdx];

  // 부드러운 패드 엔벨로프 (각 4초 구간에서 매끄럽게 페이드 인/아웃)
  const padEnv = Math.sin((localChordT / 4) * Math.PI);
  const smoothPadEnv = 0.35 + 0.65 * Math.pow(padEnv, 0.7);

  let sample = 0;

  // 따뜻한 로우패스 느낌의 패드 화음
  for (let n = 0; n < chord.length; n++) {
    const freq = chord[n] * 0.5; // 한 옥타브 아래로 낮춰 눈과 귀가 편안한 중저역 패드
    const detune = 1 + (n - 2) * 0.0008;
    const wave =
      0.75 * Math.sin(2 * Math.PI * freq * detune * t) +
      0.25 * Math.sin(2 * Math.PI * freq * 2 * detune * t);
    sample += (wave / chord.length) * 0.24 * smoothPadEnv;
  }

  // 1초마다 은은하게 울리는 부드러운 일렉트릭 피아노 톤
  const arpIdx = Math.floor(t) % ARP_NOTES.length;
  const localArpT = t % 1;
  const arpFreq = ARP_NOTES[arpIdx];
  const arpAttack = Math.min(1, localArpT / 0.04);
  const arpDecay = Math.exp(-localArpT * 3.2);
  const arpWave =
    0.85 * Math.sin(2 * Math.PI * arpFreq * t) +
    0.15 * Math.sin(2 * Math.PI * arpFreq * 2 * t) * Math.exp(-localArpT * 6);
  sample += arpWave * 0.085 * arpAttack * arpDecay;

  // 심리스 루프를 위한 시작/끝 0.05초 미세 크로스페이드
  let edgeFade = 1;
  const fadeSamples = Math.floor(SAMPLE_RATE * 0.05);
  if (i < fadeSamples) edgeFade = i / fadeSamples;
  else if (i > NUM_SAMPLES - fadeSamples) edgeFade = (NUM_SAMPLES - i) / fadeSamples;

  pcm[i] = Math.max(-0.95, Math.min(0.95, sample * edgeFade));
}

// 16-bit PCM WAV 헤더 및 데이터 작성
const dataByteLength = NUM_SAMPLES * 2;
const buffer = Buffer.alloc(44 + dataByteLength);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataByteLength, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);        // PCM chunk size
buffer.writeUInt16LE(1, 20);         // AudioFormat = PCM
buffer.writeUInt16LE(1, 22);         // NumChannels = Mono
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // ByteRate
buffer.writeUInt16LE(2, 32);         // BlockAlign
buffer.writeUInt16LE(16, 34);        // BitsPerSample
buffer.write('data', 36);
buffer.writeUInt32LE(dataByteLength, 40);

for (let i = 0; i < NUM_SAMPLES; i++) {
  const int16 = Math.round(pcm[i] * 32767);
  buffer.writeInt16LE(int16, 44 + i * 2);
}

const outDir = path.join(__dirname, '..', 'public', 'audio');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'bgm-ambient.wav');
fs.writeFileSync(outPath, buffer);
console.log(`Generated BGM file: ${outPath} (${buffer.length} bytes, ${DURATION_SEC}s loop)`);
