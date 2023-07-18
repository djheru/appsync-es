import * as _ from 'lodash';
import {
  createAccount,
  creditAccount,
  debitAccount,
  getAccountEvents,
} from '../repository/account';

export enum EventType {
  CREATED = 'CREATED',
  CREDITED = 'CREDITED',
  DEBITED = 'DEBITED',
  SNAPSHOT = 'SNAPSHOT',
}

export type Account = {
  auth0Id: string;
  availableTokens: number;
  email: string;
  id: string;
  timestamp: string;
  version: number;
};

export type GetAccountInputType = {
  id: string;
};
export type ListAccountsInputType = {
  limit?: number;
  nextToken?: string;
};
export type CreateAccountInputType = {
  auth0Id: string;
  email: string;
};
export type CreditDebitAccountInputType = {
  id: string;
  amount: number;
};

export type CreateAccountEvent = {
  auth0Id: string;
  availableTokens: number;
  email: string;
  id: string;
  timestamp: string;
  type: EventType.CREATED;
  version: number;
};

export type AccountSnapshotEvent = {
  auth0Id: string;
  availableTokens: number;
  email: string;
  id: string;
  timestamp: string;
  type: EventType.SNAPSHOT;
  version: number;
};

export type CreditAccountEvent = {
  amount: number;
  id: string;
  timestamp: string;
  type: EventType.CREDITED;
  version: number;
};

export type DebitAccountEvent = {
  amount: number;
  id: string;
  timestamp: string;
  type: EventType.DEBITED;
  version: number;
};

export type AccountEvent =
  | CreateAccountEvent
  | AccountSnapshotEvent
  | CreditAccountEvent
  | DebitAccountEvent;

export const create = async (id: string, input: CreateAccountInputType) => {
  const { auth0Id, email } = input;

  const createEvent: CreateAccountEvent = {
    auth0Id,
    availableTokens: 1,
    email,
    id,
    timestamp: new Date().toJSON(),
    type: EventType.CREATED,
    version: 1,
  };
  await createAccount(createEvent);
  const account = await get(id);
  return account;
};

export const credit = async (event: CreditDebitAccountInputType) => {
  const accountDetails = await get(event.id);
  if (!accountDetails) {
    return null;
  }
  const { account: currentAccount, itemsSinceSnapshot } = accountDetails;
  let version = currentAccount.version;
  let snapshotEvent;

  if (itemsSinceSnapshot.length >= 9) {
    snapshotEvent = {
      ...currentAccount,
      version: ++version,
      type: EventType.SNAPSHOT,
    } as AccountSnapshotEvent;
  }

  const creditEvent: CreditAccountEvent = {
    id: event.id,
    version: ++version,
    type: EventType.CREDITED,
    amount: event.amount,
    timestamp: new Date().toJSON(),
  };

  await creditAccount(creditEvent, snapshotEvent);

  const updatedAccount = await get(event.id);
  return updatedAccount;
};

export const debit = async (event: CreditDebitAccountInputType) => {
  const accountDetails = await get(event.id);
  if (!accountDetails) {
    return null;
  }
  const { account: currentAccount, itemsSinceSnapshot } = accountDetails;

  if (currentAccount.availableTokens < event.amount) {
    throw new Error('Insufficient tokens for debit');
  }

  let version = currentAccount.version;
  let snapshotEvent;

  if (itemsSinceSnapshot.length >= 9) {
    snapshotEvent = {
      ...currentAccount,
      version: ++version,
      type: EventType.SNAPSHOT,
    } as AccountSnapshotEvent;
  }

  const debitEvent: DebitAccountEvent = {
    id: event.id,
    version: ++version,
    type: EventType.DEBITED,
    amount: event.amount,
    timestamp: new Date().toJSON(),
  };

  await debitAccount(debitEvent, snapshotEvent);

  const updatedAccount = await get(event.id);
  return updatedAccount;
};

export const get = async (id: string) => {
  const items = await getAccountEvents(id);

  const snapshotIdx = items?.findIndex(
    (item) => item.type === EventType.SNAPSHOT,
  );
  const snapshot = items[snapshotIdx] as Account;

  if (!snapshot) {
    console.log(`Account ID ${id} not found`);
    return null;
  }

  const itemsSinceSnapshot: AccountEvent[] = _.reverse(
    _.range(0, snapshotIdx).map((idx) => items[idx]),
  );

  const account = itemsSinceSnapshot.reduce(
    (state: Account, item: AccountEvent) => {
      let availableTokens = state.availableTokens;
      const version = item.version;

      if (item.type === EventType.DEBITED) {
        availableTokens -= item.amount || 0;
      } else if (item.type === EventType.CREDITED) {
        availableTokens += item.amount || 0;
      }
      return { ...state, availableTokens, version };
    },
    { ...snapshot } as Account,
  );

  return {
    account,
    snapshot,
    itemsSinceSnapshot,
  };
};
