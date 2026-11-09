import { connection } from 'next/server';
import { loadLatestRun, loadQuestions, summarize } from '../../../lib/evaluate';

/** Latest evaluation run and its summary, for the Quality page. */
export async function GET() {
  await connection();
  const questions = loadQuestions();
  const run = loadLatestRun();
  return Response.json({ summary: summarize(run, questions), results: run?.results ?? [], questions });
}
