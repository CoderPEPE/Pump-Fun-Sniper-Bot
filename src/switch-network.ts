import * as fs from 'fs';
import * as readline from 'readline';

// Create readline interface for user confirmation
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Network configurations
const networks = {
    devnet: {
        endpoint: "https://api.devnet.solana.com",
        blockEngine: "ny.devnet.block-engine.jito.wtf"
    },
    mainnet: {
        endpoint: "https://api.mainnet-beta.solana.com",
        blockEngine: "ny.mainnet.block-engine.jito.wtf"
    }
};

/**
 * Updates the .env file with the specified network configuration
 * @param network The network to switch to ('devnet' or 'mainnet')
 */
function switchNetwork(network: 'devnet' | 'mainnet') {
    try {
        // Read the current .env file
        const envPath = '.env';
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        // Replace the endpoint
        envContent = envContent.replace(
            /ENDPOINT = ".*"/,
            `ENDPOINT = "${networks[network].endpoint}"`
        );
        
        // Replace the block engine URL
        envContent = envContent.replace(
            /BLOCK_ENGINE_URL=".*"/,
            `BLOCK_ENGINE_URL="${networks[network].blockEngine}"`
        );
        
        // Write the updated content back to the .env file
        fs.writeFileSync(envPath, envContent);
        
        console.log(`✅ Successfully switched to ${network.toUpperCase()}`);
        console.log(`Endpoint: ${networks[network].endpoint}`);
        console.log(`Block Engine: ${networks[network].blockEngine}`);
    } catch (error) {
        console.error('Error updating .env file:', error);
    }
}

// Main function
function main() {
    rl.question('Which network do you want to use? (devnet/mainnet): ', (answer) => {
        const network = answer.toLowerCase().trim();
        
        if (network === 'devnet' || network === 'mainnet') {
            if (network === 'mainnet') {
                rl.question('⚠️ WARNING: Switching to MAINNET will use real funds. Type "CONFIRM" to proceed: ', (confirmation) => {
                    if (confirmation.trim() === 'CONFIRM') {
                        switchNetwork(network);
                    } else {
                        console.log('Operation cancelled. Staying on current network.');
                    }
                    rl.close();
                });
            } else {
                switchNetwork(network);
                rl.close();
            }
        } else {
            console.log('Invalid network. Please specify "devnet" or "mainnet".');
            rl.close();
        }
    });
}

// Run the main function
main();
