import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, NATIVE_MINT } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { logger } from "./logger";

export const checkIfTokenATAExists = async (keypair: Keypair, mint: string, connection: Connection): Promise<boolean> => {
    const tokenATA = await getAssociatedTokenAddress(new PublicKey(mint), keypair.publicKey);
    const tokenAccount = await connection.getAccountInfo(tokenATA);
    if (!tokenAccount) {
        logger.info(`Token account not found for keypair ${keypair.publicKey.toString()}`);
        return false;
    } else {
        return true;
    }
}

export const createTokenAta = async (keypair: Keypair, mint: string, connection: Connection): Promise<boolean> => {
    const instructions: TransactionInstruction[] = [];

    const tokenATA = await getAssociatedTokenAddress(new PublicKey(mint), keypair.publicKey);
    const tokenAccount = await connection.getAccountInfo(tokenATA);
    if (!tokenAccount) {
        logger.info(`Creating token account for keypair ${keypair.publicKey.toString()}`);
        // Add instruction to create the token account
        const createAtaIx = createAssociatedTokenAccountInstruction(
            keypair.publicKey,
            tokenATA,
            keypair.publicKey,
            new PublicKey(mint),
        );
        instructions.push(createAtaIx);
    }

    if (instructions.length === 0) {
        // logger.info(`Token account already exists for keypair ${keypair.publicKey.toString()}`);
        return true;
    }

    // Send the transaction and wait for confirmation
    const latestBlockhash = await connection.getLatestBlockhash("finalized");
    // Create a TransactionMessage
    const messageV0 = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: instructions
    }).compileToV0Message();

    // Create a VersionedTransaction
    const transaction = new VersionedTransaction(messageV0);
    // Sign the transaction
    transaction.sign([keypair]);

    const simulationSuccess = await simulateTransaction(connection, transaction);
    if (!simulationSuccess) {
        logger.error("Failed to simulate transaction");
        return false;
    }

    // Send the transaction and wait for confirmation
    const signature = await connection.sendRawTransaction(transaction.serialize());
    logger.info(`Sent create ATA transaction with signature ${signature}`);

    const isConfirmed = await confirmTransaction(connection, signature);
    if (!isConfirmed) {
        logger.error("Failed to confirm transaction");
        return false;
    } else {
        logger.info("Transaction confirmed", signature);
        return true;
    }
}

export const createWSolAndTokenAtas = async (wallets: Keypair[], mint: string, connection: Connection) => {
    for (let i = 0; i < wallets.length; i++) {
        const keypair = wallets[i];
        await createTokenAta(keypair, mint, connection);
    }
}

export const getRandomWallets = (num: number, wallets: Keypair[]): Keypair[] => {
    const swapPairs: Keypair[] = [];

    while (swapPairs.length < num) {
        const wallet = wallets[Math.floor(Math.random() * wallets.length)];

        if (swapPairs.find((pair) => pair.publicKey.toBase58() == wallet.publicKey.toBase58())) {
            continue;
        }
        swapPairs.push(wallet);
    }
    return swapPairs;
}

export const confirmTransaction = async (connection: Connection, signature: string): Promise<boolean> => {
    let retries = 0;
    const maxRetries = 5;
    let isConfirmed = false;

    while (retries < maxRetries) {
        retries++;

        logger.info(`Attempt ${retries} to confirm transaction ${signature}`);
        // Fetch the latest blockhash and last valid block height
        const latestBlockhash = await connection.getLatestBlockhash("finalized");

        // Confirm the transaction using the new method signature
        const confirmation = await connection.confirmTransaction(
            {
                signature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            },
            "confirmed"
        );

        if (!confirmation.value.err) {
            isConfirmed = true;
            break;
        }
    }

    return isConfirmed;
}


export const distributeSol = async (payer: Keypair, wallets: Keypair[], amount: number, connection: Connection) => {
    for (let i = 0; i < wallets.length; i++) {
        const keypair = wallets[i];

        let retries = 0;
        const maxRetries = 5;

        while (retries < maxRetries) {
            retries++;
            try {
                const { blockhash } = await connection.getLatestBlockhash("finalized");
                // Create a transfer instruction
                const transferInstruction = SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: keypair.publicKey,
                    lamports: amount,
                });

                // Create a TransactionMessage
                const messageV0 = new TransactionMessage({
                    payerKey: payer.publicKey,
                    recentBlockhash: blockhash,
                    instructions: [transferInstruction]
                }).compileToV0Message();

                // Create a VersionedTransaction
                const transaction = new VersionedTransaction(messageV0);
                // Sign the transaction
                transaction.sign([payer]);

                // Send the transaction and wait for confirmation
                const signature = await connection.sendTransaction(transaction);

                logger.info(`Sent ${amount / 10 ** 9} SOL to ${keypair.publicKey.toBase58()} with signature ${signature}`);

                const isSimulationSuccess = await simulateTransaction(connection, transaction);
                if (!isSimulationSuccess) {
                    logger.error("Failed to simulate transaction");
                    return;
                }

                const isConfirmed = await confirmTransaction(connection, signature);
                if (!isConfirmed) {
                    logger.error("Failed to confirm transaction");
                } else {
                    logger.info("Transaction confirmed: ", signature);
                    break;
                }
            } catch (error) {
                logger.error("Error during distribution:", error);
                throw error;
            }
        }
    }
}

export const simulateTransaction = async (connection: Connection, transaction: VersionedTransaction): Promise<boolean> => {
    let success = false;
    const simulationResult = await connection.simulateTransaction(transaction, { commitment: "processed" });
    if (simulationResult.value.err) {
        logger.error(`Simulation error for transaction:`);
        console.log(simulationResult);
        console.log(simulationResult.value.err);
        // logger.error(`Simulation error for transaction value err: ${simulationResult.value.err}`, );
    } else {
        success = true;
    }
    return success;
}

export const getTokenBalance = async (connection: Connection, mintAddress: string, keypair: Keypair) => {
    const ownerPubKey = keypair.publicKey;

    const response = await connection.getParsedTokenAccountsByOwner(ownerPubKey, {
        mint: new PublicKey(mintAddress),
    });

    let tokenBalance = 0;
    for (const account of response.value) {
        const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
        tokenBalance += amount;
    }

    return tokenBalance;
}

// convert amount to units
export const formatUnits = (amount: number, decimals: number): number => {
    return Number((amount / Math.pow(10, decimals)).toFixed(0));
}

// convert units to amount
export const parseUnits = (units: number, decimals: number): number => {
    return Number((units * Math.pow(10, decimals)).toFixed(0));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const chunkArray = <T>(array: T[], size: number): T[][] => {
    return Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
}