export type RootStackParamList = {
  Home: undefined;
  Group: { groupId: string; name?: string };
  ExpenseForm: { groupId: string; expenseId?: string };
  Settle: { groupId: string };
};
