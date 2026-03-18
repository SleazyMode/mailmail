import { randomUUID } from "node:crypto";

export const generateInternalMessageId = (): string => randomUUID();
