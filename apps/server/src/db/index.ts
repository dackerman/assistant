import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import "dotenv/config";

// Create a PostgreSQL connection
const connectionString =
  process.env.NODE_ENV === "test"
    ? process.env.TEST_DATABASE_URL!
    : process.env.DATABASE_URL!;

// For query purposes
const queryClient = postgres(connectionString);

// Create drizzle instance
export const db = drizzle(queryClient, { schema });

// Export schema for easy access
export * from "./schema";

// Utility function to clean up connections
export async function closeDatabase() {
  await queryClient.end();
}
