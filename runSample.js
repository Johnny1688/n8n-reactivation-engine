const input = require('./samples/marea.json');
const { buildAIContext } = require('./src/context/buildAIContext.js');

const output = buildAIContext(input);

console.log(JSON.stringify(output, null, 2));
