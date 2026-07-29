module.exports = async function exampleCustomProvider(context) {
  return {
    output: `CUSTOM_PROVIDER_READY ${context.prompt}`,
    usage: { total_tokens: 7 },
    finishReason: 'stop',
    cost: 0,
  };
};
