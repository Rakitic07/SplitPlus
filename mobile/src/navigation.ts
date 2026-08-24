export type RootStackParamList = {
  Home: undefined;
  Group: { groupId: string; name?: string };
  ExpenseForm: { groupId: string };
  Settle: { groupId: string };
};
