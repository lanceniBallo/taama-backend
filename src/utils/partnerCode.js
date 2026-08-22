const crypto = require("crypto");

// Alphabet sans caractères ambigus (pas de 0/O, 1/I/L)
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateAccessCode() {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

function hashAccessCode(code) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(code.toUpperCase())
    .digest("hex");
}

module.exports = { generateAccessCode, hashAccessCode };
