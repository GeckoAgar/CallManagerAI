const { z } = require('zod');

const pageSizes = new Set([10, 25, 50]);
const pageSchema = z.string().regex(/^[1-9]\d*$/);
const limitSchema = z.string().regex(/^\d+$/).refine((value) => pageSizes.has(Number(value)));
const searchSchema = z.string().max(255);

function parsePagination(query) {
  const hasPage = Object.hasOwn(query, 'page');
  const hasLimit = Object.hasOwn(query, 'limit');
  const hasSearch = Object.hasOwn(query, 'search');
  if (!hasPage && !hasLimit && !hasSearch) return null;

  const rawPage = hasPage ? query.page : '1';
  const rawLimit = hasLimit ? query.limit : '10';
  const rawSearch = hasSearch ? query.search : '';
  if (!pageSchema.safeParse(rawPage).success) {
    return { error: 'El parámetro page debe ser un entero positivo.' };
  }
  if (!limitSchema.safeParse(rawLimit).success) {
    return { error: 'El parámetro limit debe ser 10, 25 o 50.' };
  }
  if (!searchSchema.safeParse(rawSearch).success) {
    return { error: 'El parámetro search debe ser texto de hasta 255 caracteres.' };
  }

  const page = Number(rawPage);
  if (!Number.isSafeInteger(page)) {
    return { error: 'El parámetro page está fuera del rango permitido.' };
  }

  return { page, limit: Number(rawLimit), search: rawSearch.trim() };
}

function createPagination(total, requestedPage, limit) {
  const totalPages = Math.ceil(total / limit);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);

  return {
    total,
    page,
    limit,
    totalPages,
    offset: (page - 1) * limit,
  };
}

function paginatedResponse(data, pagination) {
  const { offset, ...metadata } = pagination;
  return { data, ...metadata };
}

module.exports = { createPagination, paginatedResponse, parsePagination };
