import { AppSyncResolverEvent, Context } from 'aws-lambda';
import { ulid } from 'ulid';
import {
  CreateAccountInputType,
  CreditDebitAccountInputType,
  GetAccountInputType,
  create,
  credit,
  debit,
  get,
} from './models/account';

const createAccount = async ({ auth0Id, email }: CreateAccountInputType) => {
  console.log('createAccount: %j', { auth0Id, email });
  const accountId = ulid();

  const account = await create(accountId, { auth0Id, email });
  console.log('createAccount: %j', account);
  return account;
};

const getAccount = async ({ id }: GetAccountInputType) => {
  console.log('getAccount: %j', id);
  const { account } = await get(id);

  console.log('getAccount: %j', account);
  return account;
};

const creditAccount = async ({ id, amount }: CreditDebitAccountInputType) => {
  console.log('creditAccount: %j', { id, amount });
  const account = await credit({ id, amount });

  console.log('creditAccount: %j', account);
  return account;
};

const debitAccount = async ({ id, amount }: CreditDebitAccountInputType) => {
  console.log('debitAccount: %j', { id, amount });
  const account = await debit({ id, amount });

  console.log('debitAccount: %j', account);
  return account;
};

type OperationFunction = (data: Record<string, unknown>) => Promise<unknown>;

const operations: { [key: string]: { [key: string]: OperationFunction } } = {
  Query: { getAccount: getAccount as OperationFunction },

  Mutation: {
    createAccount: createAccount as OperationFunction,
    creditAccount: creditAccount as OperationFunction,
    debitAccount: debitAccount as OperationFunction,
  },
};

exports.handler = async (
  event: AppSyncResolverEvent<{ [key: string]: string | number }>,
  ctx: Context,
) => {
  console.log('event: %j', event);
  console.log('ctx: %j', ctx);
  const {
    arguments: args,
    info: { parentTypeName: typeName, fieldName },
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
