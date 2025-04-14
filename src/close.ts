require("dotenv").config({ path: process.env.env_file });
import { solWalletCloseAllTokenAccount, solWalletImport } from "dv-sol-lib";
import * as readline from 'readline';

const gsinger = solWalletImport(process.env.PRIVATE_KEY || "")

// Create readline interface for user confirmation
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function main() {
    try {
        // Require explicit user confirmation before closing token accounts
        rl.question('WARNING: This will close all token accounts. Type "CONFIRM" to proceed: ', async (answer) => {
            if (answer.trim() === 'CONFIRM') {
                console.log('Closing token accounts...');
                await solWalletCloseAllTokenAccount(gsinger!, 0.00001);
                console.log('Token accounts closed successfully.');
            } else {
                console.log('Operation cancelled by user.');
            }
            rl.close();
        });
    } catch (error) {
        console.error('Error closing token accounts:', error);
        rl.close();
    }
}

main();
