import {
  Commitment,
  ComputeBudgetProgram,
  Connection,
  Finality,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  VersionedTransactionResponse,
} from "@solana/web3.js";
import { PriorityFee, TransactionResult } from "./types";
import { addTipToTransaction, sendBundle } from "../jito";
import { confirmTransaction, simulateTransaction } from "../utils";
import bs58 from "bs58";
import { solanaWeb3, Solana } from "@quicknode/sdk";

export const DEFAULT_COMMITMENT: Commitment = "finalized";
export const DEFAULT_FINALITY: Finality = "finalized";

export const calculateWithSlippageBuy = (
  amount: bigint,
  basisPoints: bigint
) => {
  return amount + (amount * basisPoints) / 10000n;
};

export const calculateWithSlippageSell = (
  amount: bigint,
  basisPoints: bigint
) => {
  return amount - (amount * basisPoints) / 10000n;
};

export async function sendTx(
  connection: Connection,
  tx: Transaction,
  payer: PublicKey,
  signers: Keypair[],
  priorityFees?: PriorityFee,
  commitment: Commitment = DEFAULT_COMMITMENT,
  finality: Finality = DEFAULT_FINALITY
): Promise<TransactionResult> {
  try {
    const endpoint = new Solana({
      endpointUrl:
        "https://fragrant-shy-mansion.solana-mainnet.quiknode.pro/8adcdcdffceeca3330fa483e8ec167773afd46d1",
    });

    let versionedTx = await buildVersionedTx(connection, payer, tx, commitment);
    versionedTx.sign(signers);

    const isSimulationSuccess = await simulateTransaction(connection, versionedTx);
    if (!isSimulationSuccess) {
      return {
        success: false,
        error: "Failed to simulate transaction",
      };
    }

    const latestBlockhash = await connection.getLatestBlockhash(commitment)
    tx.recentBlockhash = latestBlockhash.blockhash;

    const signature = await endpoint.sendSmartTransaction({
      transaction: tx,
      keyPair: signers[0],
      feeLevel: "recommended"
    });

    const isTxConfirmed = await confirmTransaction(connection, signature);
    if (!isTxConfirmed) {
      return {
        success: false,
        error: "Failed to confirm transaction",
      };
    }
    console.log("Transaction:", `https://solscan.io/tx/${signature}`);

    let txResult = await getTxDetails(connection, signature, commitment, finality);
    if (!txResult) {
      return {
        success: false,
        error: "Transaction failed",
      };
    }
    return {
      success: true,
      signature: signature,
      results: txResult,
    };
  } catch (e) {
    if (e instanceof SendTransactionError) {
      let ste = e as SendTransactionError;
      // @ts-ignore
      console.log("SendTransactionError" + await ste.getLogs(connection));
    } else {
      console.error(e);
    }
    return {
      error: e,
      success: false,
    };
  }
}

export const buildVersionedTx = async (
  connection: Connection,
  payer: PublicKey,
  tx: Transaction,
  commitment: Commitment = DEFAULT_COMMITMENT
): Promise<VersionedTransaction> => {
  const blockHash = (await connection.getLatestBlockhash(commitment))
    .blockhash;

  let messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockHash,
    instructions: tx.instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
};

export const getTxDetails = async (
  connection: Connection,
  sig: string,
  commitment: Commitment = DEFAULT_COMMITMENT,
  finality: Finality = DEFAULT_FINALITY
): Promise<VersionedTransactionResponse | null> => {
  const latestBlockHash = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    {
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: sig,
    },
    commitment
  );

  return connection.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: finality,
  });
};

function convertVersionedToLegacyTransaction(versionedTransaction): Transaction {
  // Check if it's a v0 transaction
  if (versionedTransaction.version !== 0) {
    throw new Error(`Only v0 versioned transactions are supported, received v${versionedTransaction.version}`);
  }

  // Get the message from the versioned transaction
  const message = versionedTransaction.message;

  // Check if the transaction uses address lookup tables
  if (message.addressTableLookups && message.addressTableLookups.length > 0) {
    throw new Error('Cannot convert versioned transaction with address lookup tables to legacy transaction');
  }

  // Create a new legacy Transaction
  const transaction = new Transaction();

  // Set the recent blockhash and fee payer
  transaction.recentBlockhash = message.recentBlockhash;
  transaction.feePayer = message.staticAccountKeys[0]; // Typically the first account is the fee payer

  // Add all instructions
  message.compiledInstructions.forEach((instruction) => {
    const programId = message.staticAccountKeys[instruction.programIdIndex];

    // Map account indices to actual account public keys
    const accounts = instruction.accountKeyIndexes.map(
      (index: number) => message.staticAccountKeys[index]
    );

    // Create and add the instruction
    const transactionInstruction = new TransactionInstruction({
      programId,
      keys: accounts.map((pubkey, idx) => ({
        pubkey,
        isSigner: message.isAccountSigner(idx),
        isWritable: message.isAccountWritable(idx)
      })),
      data: Buffer.from(instruction.data)
    });

    transaction.add(transactionInstruction);
  });

  return transaction;
}                                                                                                                                                                                                                                                                                                                             