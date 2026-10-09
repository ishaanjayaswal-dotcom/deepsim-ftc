export function normalizeSearch(text: string): string {
  return text.toLocaleLowerCase("und").replace(/ς/g, "σ");
}

export function searchText(row: { name: string; description: string; category: string; teamNumber: number }): string {
  return normalizeSearch([row.name, row.description, row.category, row.teamNumber].join("\n"));
}
