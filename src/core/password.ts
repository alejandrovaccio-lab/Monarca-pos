import { argon2id } from "@node-rs/argon2";

const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) {
    throw new Error("Password must contain at least 10 characters.");
  }
  return argon2id.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2id.verify(hash, password);
}
