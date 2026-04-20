const fs = require('fs');
const path = require('path');
const { buildAIContext } = require('./src/context/buildAIContext.js');

// ── parse args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const batchIdx = args.indexOf('--batch');

if (batchIdx !== -1) {
  // ── Mode 2: batch directory ───────────────────────────────
  const dir = args[batchIdx + 1];
  if (!dir) { console.error('Usage: node runSample.js --batch <directory>'); process.exit(1); }
  const absDir = path.resolve(dir);
  const files = fs.readdirSync(absDir).filter(f => f.endsWith('.json')).sort();

  let total = 0, ok = 0, empty = 0, noAi = 0, errCount = 0, placeholder = 0;
  let wordSum = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    total++;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(absDir, file), 'utf8'));
      const pk = raw.project_key || file;

      // Use pre-existing AI output — skip if absent
      const finalMsg =
        (raw.enforce_parsed && raw.enforce_parsed.whatsapp_message) ||
        raw.whatsapp_message ||
        (raw.ai_parsed && raw.ai_parsed.whatsapp_message) ||
        raw._en ||
        undefined;

      if (finalMsg === undefined) {
        console.log(`[${i + 1}/${files.length}] ${pk} | NO_AI_OUTPUT`);
        noAi++;
        continue;
      }

      const imt = raw.is_my_turn_to_reply != null ? raw.is_my_turn_to_reply : '?';
      const hnn = raw.has_not_now_signal != null ? raw.has_not_now_signal : '?';
      const hns = raw.hard_no_send != null ? raw.hard_no_send : '?';

      const isEmptyMsg = !finalMsg || finalMsg.trim() === '';
      const preview = isEmptyMsg ? 'EMPTY' : finalMsg.substring(0, 120);

      console.log(`[${i + 1}/${files.length}] ${pk} | STATE: is_my_turn=${imt}, has_not_now=${hnn}, hard_no_send=${hns} | OUT: ${preview}`);

      if (isEmptyMsg) {
        empty++;
      } else {
        ok++;
        wordSum += finalMsg.split(/\s+/).filter(Boolean).length;
        if (/\{\{[^}]+\}\}/.test(finalMsg)) {
          placeholder++;
        }
      }
    } catch (err) {
      errCount++;
      console.log(`[${i + 1}/${files.length}] ${file} | ERROR: ${err.message}`);
    }
  }

  // ── summary ───────────────────────────────────────────────
  console.log('\n================================');
  console.log('BATCH SUMMARY');
  console.log('================================');
  console.log(`Total:              ${total}`);
  console.log(`Message generated:  ${ok}`);
  console.log(`EMPTY:              ${empty}`);
  console.log(`NO_AI_OUTPUT:       ${noAi}`);
  console.log(`Errors:             ${errCount}`);
  console.log(`Placeholder leak:   ${placeholder}`);
  console.log(`Avg word count:     ${ok > 0 ? (wordSum / ok).toFixed(1) : 'N/A'}`);

} else {
  // ── Mode 1: single file (original behavior) ──────────────
  const samplePath = args[0] || './samples/marea.json';
  const input = JSON.parse(fs.readFileSync(path.resolve(samplePath), 'utf8'));
  const output = buildAIContext(input);
  console.log(JSON.stringify(output, null, 2));
}
