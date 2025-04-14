import { NATIVE_MINT } from "@solana/spl-token"
import { config } from "./config"
import {
  PF_ACCOUNT,
  PF_FEE_RECIPIENT,
  BLOXROUTER,
  PUMPFUN,
  PF_GLOBAL,
  PF_MINT_AUTHORITY,
  PF_PROGRAM_ID,
  RENT,
  solPFGetTokensCreatedByWallet,
  solWalletGetBalance,
  solAddrStr
} from "dv-sol-lib"
import { isInBlacklist } from "./blacklist"

export const whitelist: string[] = []
export let buyingTokens: any[] = []

const EXCLUDES: string[] = [
  PF_MINT_AUTHORITY,
  PF_PROGRAM_ID.toBase58(),
  PF_FEE_RECIPIENT.toBase58(),
  PF_ACCOUNT.toBase58(),
  PF_GLOBAL.toBase58(),
  RENT.toBase58(),
  BLOXROUTER,
  NATIVE_MINT.toBase58(),
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  "ComputeBudget111111111111111111111111111111",
  "4uks6GfvhLaqJxWrZZYYxfbU24Kz7318VLXQozKQav6V", // slerftools.sol
]

const PF_ACCOUNTS = [
  PF_PROGRAM_ID.toBase58(),
  PF_FEE_RECIPIENT.toBase58(),
  PF_MINT_AUTHORITY
]


const creationMap: any = {}
export const temporayLUT: any = {}

export function addLutTemporary(signer: string, wallets: string[], slot?: number): any {
  if (!slot)
    return
  if (!temporayLUT[signer]) {
    temporayLUT[signer] = {
      subwallets: wallets,
      slot
    }
    setTimeout(() => {
      // console.log(`[LOG](Whitelist) Deleting temporary LUT...`)
      delete temporayLUT[signer]
    }, 10000)
  } else if (slot < temporayLUT[signer].slot + 5) {
    wallets.forEach((w: string) => {
      if (!temporayLUT[signer].subwallets.find((entry: string) => entry === w))
        temporayLUT[signer].subwallets.push(w)
    });
  }
}

export async function addCreator(creator: string) {
  return
  const createdTokenCount = (await solPFGetTokensCreatedByWallet(creator, 1)).length
  creationMap[creator] = createdTokenCount
}

export function isCreateTokenExceeds(wallet: string): boolean {
  // if (config.maxCreatedTokens !== undefined) {
  //   let createdTokenCount = creationMap[wallet]
  //   if (createdTokenCount === undefined)
  //     return true
  //   if (createdTokenCount > config.maxCreatedTokens) {
  //     console.log(`[LOG](Whitelist) Exceeds number of created token count(${createdTokenCount}) by creator: ${wallet} ...`,)
  //     return true
  //   }
  // }
  return false
}

export async function WhitelistAdd(wallet: string, subwallets: string[], slot: number): Promise<void> {
  addLutTemporary(wallet, subwallets, slot)
  subwallets = temporayLUT[wallet].subwallets
  if (!subwallets.find((a: string) => PF_ACCOUNTS.includes(a)))
    return

  subwallets = subwallets.filter((w: string) => !EXCLUDES.find((e: string) => e === w))
  // // skip if subwallets include 'pump' token ca
  // if (subwallets && subwallets.some((w: string) => w.endsWith('pump'))) {
  //   if (!subwallets.find((w: string) => w === RENT.toBase58())) {
  //     console.log(`[LOG](Whitelist) Subwallets include 'pump' but no rent, skipping ...`)
  //     return
  //   }
  // }
  const totalWallets = [wallet]
  if (subwallets && subwallets.length)
    totalWallets.push(...subwallets)

  if (config.minLUTCount && totalWallets.length < config.minLUTCount) {
    console.log(`[LOG](Whitelist) Wallet count doesn't reach minimum. walletCount = ${totalWallets.length}, creator = ${wallet}`)
    return
  }

  let tBalance = 0
  let needToAdd = false
  const balanceMap: any = {}
  for (const w of totalWallets) {
    try {
      addCreator(w)
      if (w === wallet)
        continue
      const balance = tBalance > config.cumulativeSol ? 0 : await solWalletGetBalance(w, true, true)
      // console.log(`[${solAddrStr(w)}] balance =`, balance)
      if (balance > config.cumulativeSol)
        continue
      balanceMap[w] = balance
      tBalance += balance
      if (tBalance > config.cumulativeSol) {
        needToAdd = true
      }
    } catch (error) { }
  }

  console.log(`[LOG](Whitelist)(${wallet}) Cumulative Balance :`, tBalance)
  if (config.cumulativeBlacklist.find((balance: number) => balance.toFixed(3) === tBalance.toFixed(3))) {
    console.log(`[LOG](Whitelist)(${wallet}) #### Cumulative balance(${tBalance.toFixed(3)}) is in blacklist!`)
    return
  }

  if (needToAdd === false) {
    console.log(`[LOG](Whitelist) total balance is less than cumulative balance :`, tBalance)
    return
  }

  const finalWallets: string[] = []
  for (const w of totalWallets) {
    if (whitelist.find((wl: string) => wl === w)
      || isInBlacklist(w))
      continue;
    if (!balanceMap[w])
      addCreator(w)
    whitelist.push(w)
    finalWallets.push(w)
    setTimeout(() => WhitelistRemove(w), 15 * 60 * 1000)
  }
  console.log(`[LOG] whitelist add :`, finalWallets.map((w: string) => (w + ' : ' + balanceMap[w]?.toFixed(3) || '?')))
  delete temporayLUT[wallet]
}

export function WhitelistRemove(wallet: string) {
  const index = whitelist.findIndex((signer: string) => signer === wallet)
  if (index !== -1)
    whitelist.splice(index, 1)
  // console.log(`[LOG] ${wallet} is removed from whitelist.`)
}

export function WhitelistExist(wallet: string): boolean {
  // console.log(`[LOG] (TokenCreation) finding(${wallet}) from current whitelist:`, whitelist)
  return whitelist.find((w: string) => w === wallet) ? true : false
}

export function buyingTokenAdd(token: string, mintBlock: number) {
  buyingTokens.push({
    token,
    mintBlock,
    buyCountInMintBlock: 0
  })
}

export function buyingTokenRemove(token: string, mintBlock?: number) {
  const idx = buyingTokens.find((bt: any) => bt.token === token)
  if (idx === -1)
    return
  buyingTokens.splice(idx, 1)
}

export function buyingTokenFind(token?: string, mintBlock?: number): any {
  if (token) {
    return buyingTokens.find((bt: any) => bt.token === token)
  }
  if (mintBlock)
    return buyingTokens.find((bt: any) => bt.mintBlock === mintBlock)
  return undefined
}

export function buyingTokenIncreaseBuyCount(token: string, mintBlock?: number) {
  const idx = mintBlock
    ? buyingTokens.findIndex((bt: any) => bt.token === token && bt.mintBlock === mintBlock)
    : buyingTokens.findIndex((bt: any) => bt.token === token)
  if (idx === -1) {
    // console.log(`[LOG](buyingTokens) not found!`)
    return
  }
  buyingTokens[idx].buyCountInMintBlock++
  // console.log(`[LOG](buyingTokenIncreaseBuyCount) buyingTokens =`, buyingTokens)
}
