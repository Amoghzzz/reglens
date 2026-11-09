import dotenv from 'dotenv';
import path from 'path';
import { askQuestion } from '../src/lib/qa';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const args = process.argv.slice(2);
  const question = args.join(' ').trim();

  if (!question) {
    console.log(`\nUsage: npm run ask "Your question about RBI NBFC regulations"\n`);
    console.log(`Example:`);
    console.log(`  npm run ask "What is the maximum exposure an NBFC can have to a single party?"\n`);
    process.exit(1);
  }

  console.log(`\n===============================================================`);
  console.log(`  RegLens Regulatory Query Engine`);
  console.log(`===============================================================`);
  console.log(`Question : "${question}"\n`);

  try {
    const result = await askQuestion(question);

    console.log(`---------------------------------------------------------------`);
    console.log(`ANSWER:`);
    console.log(`---------------------------------------------------------------`);
    console.log(result.answer);
    console.log(`---------------------------------------------------------------\n`);

    console.log(`CITATIONS VERIFICATION:`);
    if (result.citations.length === 0 && result.unverifiedCitations.length === 0) {
      console.log(`  (No citations in response)`);
    } else {
      result.citations.forEach((c, idx) => {
        console.log(`  [✓ Verified ${idx + 1}] ${c.raw}`);
        console.log(`      Found in Chunk: ${c.matchingChunkId} (Page ${c.page})`);
      });

      result.unverifiedCitations.forEach((c, idx) => {
        console.log(`  [! Unverified ${idx + 1}] ${c.raw}`);
        console.log(`      Warning: Paragraph ${c.paragraph} was not found in top 8 retrieved chunks!`);
      });
    }

    console.log(`\nRETRIEVED CHUNKS (Top 8 Hybrid Search):`);
    result.retrievedResults.forEach((r) => {
      const pNums = r.chunk.paragraphNumbers.length > 0 ? `paras: ${r.chunk.paragraphNumbers.join(', ')}` : 'no paras';
      console.log(
        `  #${r.rank} [Score: ${r.score.toFixed(4)} | Vec: ${r.vectorScore.toFixed(3)} | BM25: ${r.bm25Score.toFixed(2)}] ${r.chunk.id}`
      );
      console.log(`     Pages: ${r.chunk.pageRange} | ${pNums} | Doc: ${r.chunk.document}`);
    });

    console.log(`\nMETRICS:`);
    console.log(`  Model Used : ${result.modelUsed}`);
    console.log(`  Time Taken : ${(result.timeTakenMs / 1000).toFixed(2)}s (${result.timeTakenMs} ms)`);
    console.log(`===============================================================\n`);
  } catch (err: any) {
    console.error(`Error answering question:`, err.message || err);
    process.exit(1);
  }
}

main();
