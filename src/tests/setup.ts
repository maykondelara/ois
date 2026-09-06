import { randomBytes } from "node:crypto";

// Ephemeral test configuration only; never a deployable credential.
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64url");
process.env.APP_URL ??= "https://ois.test";
