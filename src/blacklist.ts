import { readFileSync, writeFileSync } from "fs";
import { config } from "./config";

export let blacklist: any
const blacklistFile = "./blacklist.json"

function blacklistFetch() {
  try {
    const fdata = readFileSync(blacklistFile, 'utf-8')
    blacklist = JSON.parse(fdata) 
  } catch (error) {}
}

function blacklistWrite() {
  writeFileSync(blacklistFile, JSON.stringify(blacklist, null, 2))
}

export function isInBlacklist(wallet: string): boolean {
  const ret = blacklist?.find((ba:string) => ba === wallet) ? true : false
  if (ret) {
    console.error(`${wallet} is in blacklist`)
    if (config.whitelist.find((wl: string) => wl === wallet) && Math.random() > 0.7) {
      console.log(`${wallet} But it has potential. adding whitelist ...`)
      return false
    }
  }
  return ret
}

export function blackListAdd(wallet: string)  {
  if (blacklist.find((ba:string) => ba === wallet))
    return
  blacklist.push(wallet)
  blacklistWrite()
}

setInterval(blacklistFetch, 2000)