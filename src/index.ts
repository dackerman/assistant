#!/usr/bin/env node

import * as readline from "readline";
import Opencode from "@opencode-ai/sdk";
import { OpencodeError } from "@opencode-ai/sdk/index.js";
import fs from "fs";

async function listenForMessages(sessionId: string, opencode: Opencode) {
  const events = await opencode.event.list();

  // create a file called convo
  const convoStream = fs.createWriteStream("convo2.json", "utf8");

  for await (const event of events) {
    console.log(event.type);
    convoStream.write(JSON.stringify(event, null, 2));
    convoStream.write("\n");
    // if (event.type === "session.idle") {
    //   const messages = await opencode.session.messages(sessionId);

    //   for (const message of messages) {
    //     for (const part of message.parts) {
    //       if (part.type === "text") {
    //         console.log(part.text);
    //       }
    //     }
    //   }
    // }
  }
}

async function main() {
  const opencode = new Opencode({
    baseURL: "http://localhost:4096",
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  console.log(
    "Echo REPL - Type your message and I'll echo it back with excitement!"
  );
  console.log('Type "exit" or press Ctrl+C to quit\n');

  const sessions = await opencode.session.list();
  console.log(sessions);

  const session = await opencode.session.create();

  // deliberately not awaiting
  listenForMessages(session.id, opencode);

  rl.prompt();

  rl.on("line", async (input: string) => {
    const trimmedInput = input.trim();

    if (trimmedInput.toLowerCase() === "exit") {
      console.log("Goodbye!");
      rl.close();
      process.exit(0);
    }

    if (trimmedInput) {
      const response = await opencode.session.chat(session.id, {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
        parts: [
          {
            type: "text",
            text: trimmedInput,
          },
        ],
      });
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });
}

main();
