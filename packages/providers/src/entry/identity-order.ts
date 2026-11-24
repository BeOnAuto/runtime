/**
 * Who a connection may act as at its service, in the order an addition that names no way takes them: a service account
 * Auto creates and manages for the connection, then an app, then a service account the company made for automations,
 * then the account of the person who connects. It imports nothing, so that a client that orders the same choices for
 * a person, such as the page where a connection is approved, can be checked against this one order.
 */
export const identityOrder = ['managed_service_account', 'application', 'service', 'personal'] as const;

export type ConnectionIdentity = (typeof identityOrder)[number];
