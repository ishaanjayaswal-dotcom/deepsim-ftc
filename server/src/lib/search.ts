export function searchText(row: { name: string; description: string; category: string; teamNumber: number }): string {
  return [row.name, row.description, row.category, row.teamNumber].join("\n").toLocaleLowerCase("und");
}
