import { Algorithm, hash, verify } from "@node-rs/argon2";

const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: Algorithm.Argon2id,
};

export async function hashPassword(password: string) {
  if (password.length < 10) throw new Error("Password must contain at least 10 characters.");
  return hash(password, OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string) {
  return verify(storedHash, password);
}
