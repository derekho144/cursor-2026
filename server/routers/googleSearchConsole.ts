import { protectedProcedure, router } from "../_core/trpc";
import { testGscConnection, touchGscCredentialVerified } from "../googleSearchConsole";

export const googleSearchConsoleRouter = router({
  testConnection: protectedProcedure.query(async () => {
    const result = await testGscConnection();
    if (result.success) await touchGscCredentialVerified();
    return result;
  }),
});
