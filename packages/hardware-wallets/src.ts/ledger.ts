"use strict";

import { ethers } from "ethers";

import Eth from "@ledgerhq/hw-app-eth";
import Transport from "@ledgerhq/hw-transport";

// We store these in a separated import so it is easier to swap them out
// at bundle time; browsers do not get HID, for example. This maps a string
// "type" to a Transport with create.

const defaultPath = "m/44'/60'/0'/0/0";

function waiter(duration: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

export class LedgerSigner extends ethers.Signer {
  readonly type: string;
  readonly path: string;
  readonly transport: Transport;
  readonly _eth: Eth;

  constructor(
    transport: Transport,
    provider?: ethers.providers.Provider,
    type?: string,
    path?: string
  ) {
    super();
    if (path == null) {
      path = defaultPath;
    }
    if (type == null) {
      type = "default";
    }

    ethers.utils.defineReadOnly(this, "path", path);
    ethers.utils.defineReadOnly(this, "type", type);
    ethers.utils.defineReadOnly(this, "transport", transport);
    ethers.utils.defineReadOnly(this, "provider", provider || null);

    ethers.utils.defineReadOnly(this, "_eth", new Eth(transport));
  }

  _retry<T = any>(
    callback: (eth: Eth) => Promise<T>,
    timeout?: number
  ): Promise<T> {
    return new Promise(async (resolve, reject) => {
      if (timeout && timeout > 0) {
        setTimeout(() => {
          reject(new Error("timeout"));
        }, timeout);
      }

      const eth = this._eth;

      // Wait up to 5 seconds
      for (let i = 0; i < 50; i++) {
        try {
          const result = await callback(eth);
          return resolve(result);
        } catch (error) {
          if (error.id !== "TransportLocked") {
            return reject(error);
          }
        }
        await waiter(100);
      }

      return reject(new Error("timeout"));
    });
  }

  async getAddress(): Promise<string> {
    const account = await this._retry((eth) => eth.getAddress(this.path));
    return ethers.utils.getAddress(account.address);
  }

  async signMessage(message: ethers.utils.Bytes | string): Promise<string> {
    if (typeof message === "string") {
      message = ethers.utils.toUtf8Bytes(message);
    }

    const messageHex = ethers.utils.hexlify(message).substring(2);

    const sig = await this._retry((eth) =>
      eth.signPersonalMessage(this.path, messageHex)
    );
    sig.r = "0x" + sig.r;
    sig.s = "0x" + sig.s;
    return ethers.utils.joinSignature(sig);
  }

  async signTransaction(
    transaction: ethers.providers.TransactionRequest
  ): Promise<string> {
    const tx = await ethers.utils.resolveProperties(transaction);
    const baseTx: ethers.utils.UnsignedTransaction = {
      chainId: tx.chainId || undefined,
      data: tx.data || undefined,
      gasLimit: tx.gasLimit || undefined,
      gasPrice: tx.gasPrice || undefined,
      nonce: tx.nonce ? ethers.BigNumber.from(tx.nonce).toNumber() : undefined,
      to: tx.to || undefined,
      value: tx.value || undefined,
    };

    const unsignedTx = ethers.utils.serializeTransaction(baseTx).substring(2);
    const sig = await this._retry((eth) =>
      eth.signTransaction(this.path, unsignedTx)
    );

    return ethers.utils.serializeTransaction(baseTx, {
      v: ethers.BigNumber.from("0x" + sig.v).toNumber(),
      r: "0x" + sig.r,
      s: "0x" + sig.s,
    });
  }

  connect(provider: ethers.providers.Provider): ethers.Signer {
    return new LedgerSigner(provider, this.transport, this.type, this.path);
  }
}