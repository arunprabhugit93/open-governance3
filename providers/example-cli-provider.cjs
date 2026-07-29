let input = '';

process.stdin.on('data', (chunk) => {
  input += chunk.toString();
});

process.stdin.on('end', () => {
  let payload = {};
  try {
    payload = JSON.parse(input);
  } catch {
    payload = { prompt: process.env.OG_PROMPT || '' };
  }
  process.stdout.write(
    `${JSON.stringify({
      output: `CUSTOM_PROVIDER_READY ${payload.prompt || process.env.OG_PROMPT || ''}`,
      usage: { total_tokens: 8 },
      finishReason: 'stop',
      cost: 0,
    })}\n`,
  );
});
