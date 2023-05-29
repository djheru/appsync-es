import { AppSyncResolverEvent } from 'aws-lambda';
import { ulid } from 'ulid';
import { CreateAccountInputType, CreditDebitAccountInputType, GetAccountInputType, create, credit, debit, get } from './models/account';

const createAccount = async ({ auth0Id, email }: CreateAccountInputType) => {
  console.log('createAccount: %j', { auth0Id, email });
  const accountId = ulid();
  const account = await create(accountId, { auth0Id, email });
  console.log('getAccount: %j', account);
  return account;
};

const getAccount = async ({ id }: GetAccountInputType) => {
  console.log('getAccount: %j', id);
  const accountDetails = await get(id);
  console.log('getAccount: %j', accountDetails);
  const { account = {} } = accountDetails || {};
  return account;
};

const creditAccount = async ({ id, amount }: CreditDebitAccountInputType) => {
  console.log('creditAccount: %j', { id, amount });
  const accountDetails = await get(id);
  if (!accountDetails) {
    return null;
  }
  const { account, itemsSinceSnapshot } = accountDetails;

  const updated = await credit({id, amount}, account, itemsSinceSnapshot);
  console.log('updated: %j', updated);
  return updated || null;
};

const debitAccount = async ({ id, amount }: CreditDebitAccountInputType) => {
  console.log('debitAccount: %j', { id, amount });
  const accountDetails = await get(id);
  if (!accountDetails) {
    return null;
  }
  const { account, itemsSinceSnapshot } = accountDetails;

  const updated = await debit({id, amount}, account, itemsSinceSnapshot);
  console.log('updated: %j', updated);
  return updated || null;
};

// eslint-disable-next-line @typescript-eslint/ban-types
const operations: { [key: string]: { [key: string]: Function } } = {
  Query: { getAccount },
  Mutation: { createAccount, creditAccount, debitAccount }
};

exports.handler = async (event: AppSyncResolverEvent<{ [key: string]: string | number }>) => {
  console.log('event: %j', event);
  const {
    arguments: args,
    info: { parentTypeName: typeName, fieldName }
  } = event;

  const type = operations[typeName];
  if (type) {
    const operation = type[fieldName];
    if (operation) {
      return operation(args);
    }
  }
  throw new Error('unknown operation');
};