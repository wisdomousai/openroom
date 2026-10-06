import { getCollection } from 'astro:content';

export async function manual() {
  return (await getCollection('docs')).sort((a, b) => a.data.order - b.data.order);
}

export const docUrl = (id: string) => `/docs/${id}/`;

export function plainText(body: string) {
  return body.replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>|_]/g, ' ').replace(/\s+/g, ' ').trim();
}
