import { AppSyncResolverEvent, Context } from 'aws-lambda';
import { ulid } from 'ulid';
import {
  CreateAccountInputType,
  CreditDebitAccountInputType,
  GetAccountInputType,
  GetAccountListInputType,
  create,
  credit,
  debit,
  get,
  getAccounts,
} from './models/account';

/**
 * Create a new account
 * @param {CreateAccountInputType} params - Input parameters for creating an account
 * @returns {Promise<Account>} - The created account
 */
const createAccount = async ({ auth0Id, email }: CreateAccountInputType) => {
  console.log('createAccount: %j', { auth0Id, email }); // Log the input parameters
  const accountId = ulid(); // Generate a new unique ID for the account

  const account = await create(accountId, { auth0Id, email }); // Create the account
  console.log('createAccount: %j', account); // Log the created account
  return account; // Return the created account
};

/**
 * Get an account by ID
 * @param {GetAccountInputType} params - Input parameters for getting an account
 * @returns {Promise<Account>} - The retrieved account
 */
const getAccount = async ({ id }: GetAccountInputType) => {
  console.log('getAccount: %j', id); // Log the input ID
  const { account } = await get(id); // Get the account

  console.log('getAccount: %j', account); // Log the retrieved account
  return account; // Return the retrieved account
};

/**
 * Get a list of accounts
 * @param {GetAccountListInputType} params - Input parameters for getting a list of accounts
 * @returns {Promise<AccountList>} - The list of accounts
 */
const getAccountList = async ({
  nextToken,
  pageSize,
}: GetAccountListInputType) => {
  console.log('getAccountList: %j', { nextToken, pageSize }); // Log the input parameters
  const result = await getAccounts({ nextToken, pageSize }); // Get the list of accounts

  return result; // Return the list of accounts
};

/**
 * Credit an account
 * @param {CreditDebitAccountInputType} params - Input parameters for crediting an account
 * @returns {Promise<Account>} - The credited account
 */
const creditAccount = async ({ id, amount }: CreditDebitAccountInputType) => {
  console.log('creditAccount: %j', { id, amount }); // Log the input parameters
  const account = await credit({ id, amount }); // Credit the account

  console.log('creditAccount: %j', account); // Log the credited account
  return account; // Return the credited account
};

/**
 * Debit an account
 * @param {CreditDebitAccountInputType} params - Input parameters for debiting an account
 * @returns {Promise<Account>} - The debited account
 */
const debitAccount = async ({ id, amount }: CreditDebitAccountInputType) => {
  console.log('debitAccount: %j', { id, amount }); // Log the input parameters
  const account = await debit({ id, amount }); // Debit the account

  console.log('debitAccount: %j', account); // Log the debited account
  return account; // Return the debited account
};

// Type for operations
type OperationFunction = (data: Record<string, unknown>) => Promise<unknown>;

// Map of operation functions
const operations: { [key: string]: { [key: string]: OperationFunction } } = {
  Query: {
    getAccount: getAccount as OperationFunction,
    getAccountList: getAccountList as OperationFunction,
  },
  Mutation: {
    createAccount: createAccount as OperationFunction,
    creditAccount: creditAccount as OperationFunction,
    debitAccount: debitAccount as OperationFunction,
  },
};

/**
 * Lambda function handler
 * @param {AppSyncResolverEvent<{ [key: string]: string | number }>} event - The AppSync resolver event
 * @param {Context} ctx - The AWS Lambda context
 * @returns {Promise<unknown>} - The result of the operation
 */
exports.handler = async (
  event: AppSyncResolverEvent<{ [key: string]: string | number }>,
  ctx: Context,
) => {
  console.log('event: %j', event); // Log the event
  console.log('ctx: %j', ctx); // Log the context

  // Extract the arguments and operation details from the event
  const {
    arguments: args,
    info: { parentTypeName: typeName, fieldName },
  } = event;

  const type = operations[typeName]; // Get the operations for the type

  // Check if the type exists
  if (type) {
    const operation = type[fieldName]; // Get the operation

    // Check if the operation exists
    if (operation) {
      return operation(args); // Execute the operation and return the result
    }
  }

  // Throw an error if the operation does not exist
  throw new Error('unknown operation');
};
