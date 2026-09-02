import { hashPassword } from "../src/core/password";

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run password:hash -- '<password>'");
  process.exit(1);
}

hashPassword(password)
  .then(console.log)
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
