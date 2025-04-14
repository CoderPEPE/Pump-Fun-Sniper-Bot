import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
    SearcherClient,
    SearcherClientError,
    searcherClient as jitoSearcherClient,
} from 'jito-ts/dist/sdk/block-engine/searcher.js';
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
import axios from 'axios';
import bs58 from "bs58";
import dotenv from "dotenv";
import { Result } from 'jito-ts/dist/sdk/block-engine/utils';
import { Connection } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

import { PublicKey } from '@solana/web3.js';
import { logger } from './logger';
dotenv.config();

interface JitoTipFloor {
    time: string;
    landed_tips_25th_percentile: number;
    landed_tips_50th_percentile: number;
    landed_tips_75th_percentile: number;
    landed_tips_95th_percentile: number;
    landed_tips_99th_percentile: number;
    ema_landed_tips_50th_percentile: number;
}

const jitoBlockEngineUrl = 'frankfurt.mainnet.block-engine.jito.wtf';

export const getJitoTipFloor = async (): Promise<JitoTipFloor | null> => {
    try {
        const response = await axios.get<JitoTipFloor[]>('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
        const data = response.data;

        if (data && Array.isArray(data) && data.length > 0) {
            return data[0];
        } else {
            throw new Error('Invalid or empty response from API');
        }
    } catch (error) {
        console.error('Error fetching Jito tip floor data:', error);
        return null;
    }
}

export const getRandomTipAccount = async (): Promise<string | null> => {
    try {
        const response = await axios.post(
            'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'getTipAccounts',
                params: []
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        const accounts = response.data.result;

        if (accounts && accounts.length > 0) {
            return accounts[Math.floor(Math.random() * accounts.length)];
        } else {
            throw new Error('No tip accounts returned from API');
        }
    } catch (error) {
        console.error('Error fetching Jito tip accounts:', error);
        return null;
    }
}

export const sendBundle = async (bundledTxns: VersionedTransaction[]): Promise<Result<string, SearcherClientError> | undefined> => {
    try {

        const JITO_KEYPAIR = process.env.JITO_KEYPAIR;
        if (!JITO_KEYPAIR) {
            throw new Error('JITO_KEYPAIR is required');
        }

        const jitoKeypair = Keypair.fromSecretKey(bs58.decode(JITO_KEYPAIR));

        const searcherClient = jitoSearcherClient(jitoBlockEngineUrl, jitoKeypair, {
            'grpc.keepalive_timeout_ms': 4000,
        });
        console.log("Sending bundle...");
        const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
        console.log("Bundle sent successfully.");
        // console.log(bundleId);

        // ///*
        // // Assuming onBundleResult returns a Promise<BundleResult>
        // const result = await new Promise((resolve, reject) => {
        //     searcherClient.onBundleResult(
        //         (result) => {
        //             console.log("Received bundle result:", result);
        //             resolve(result); // Resolve the promise with the result
        //         },
        //         (e: Error) => {
        //             console.error("Error receiving bundle result:", e);
        //             reject(e); // Reject the promise if there's an error
        //         }
        //     );
        // });

        // console.log("Result:", result);
        return bundleId
    } catch (error) {
        const err = error as any;
        console.error("Error sending bundle:", err.message);

        if (err?.message?.includes("Bundle Dropped, no connected leader up soon")) {
            console.error("Error sending bundle: Bundle Dropped, no connected leader up soon.");
        } else {
            console.error("An unexpected error occurred:", err.message);
        }
        return undefined
    }
}

// Helper function to fetch address lookup table accounts
async function fetchAddressLookupTableAccounts(connection: any, addressLookupTableAddresses: any) {
    const addressLookupTableAccounts = [];

    for (const addressLookupTableAddress of addressLookupTableAddresses) {
        try {
            const addressLookupTableAccount = await connection.getAddressLookupTable(
                addressLookupTableAddress.accountKey
            );

            if (addressLookupTableAccount.value) {
                // @ts-ignore
                addressLookupTableAccounts.push(addressLookupTableAccount.value);
            }
        } catch (error) {
            logger.error(`Error fetching address lookup table: ${error}`);
        }
    }

    return addressLookupTableAccounts;
}

export const addTipToTransaction = async (signer: Keypair, transaction: VersionedTransaction, connection: Connection): Promise<VersionedTransaction | undefined> => {
    try {
        // Get the latest blockhash
        const { blockhash } = await connection.getLatestBlockhash("finalized");

        // Get Jito tip account and amount
        const tipAcct = await getRandomTipAccount();
        if (!tipAcct) {
            logger.error("Failed to get tip account");
            return undefined;
        }

        const jitoTips = await getJitoTipFloor();
        if (!jitoTips) {
            logger.error("Failed to get tip amount");
            return undefined;
        }

        const tipAmountLamports = Math.floor(jitoTips.landed_tips_95th_percentile * Math.pow(10, 9));
        const jitoTipAmount = new BN(tipAmountLamports.toString());
        // console.log("Jito tip amount:", jitoTipAmount.toString());

        const tipInstruction = SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: new PublicKey(tipAcct),
            lamports: jitoTipAmount.toNumber(),
        });

        const message = transaction.message;
        const addressLookupTableAccounts = await fetchAddressLookupTableAccounts(
            connection,
            message.addressTableLookups
        );

        const originalInstructions = TransactionMessage.decompile(message, {
            addressLookupTableAccounts
        }).instructions;

        const newTransactionMessage = new TransactionMessage({
            payerKey: signer.publicKey,
            recentBlockhash: blockhash,
            instructions: [...originalInstructions, tipInstruction]
        }).compileToV0Message(addressLookupTableAccounts);

        const newTransaction = new VersionedTransaction(newTransactionMessage);
        newTransaction.sign([signer]);

        return newTransaction;
    } catch (error) {
        console.error('Error adding tip to transaction:', error);
        return undefined;
    }
}