const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const openai = new OpenAI();

const speechFile = path.resolve("./speech.mp3");

async function main() {

// red text from output.txt
const text = fs.readFileSync('output.txt', 'utf8');

const mp3 = await openai.audio.speech.create({
  model: "tts-1",
  voice: "echo",
  input: text,//"Today is a wonderful day to build something people love!",
});
console.log(speechFile);
const buffer = Buffer.from(await mp3.arrayBuffer());
await fs.promises.writeFile(speechFile, buffer);
}
main();