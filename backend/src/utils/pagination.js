const pageSizes = new Set([10, 25, 50]);

function parsePagination(query) {
  const hasPage = Object.hasOwn(query, 'page');
  const hasLimit = Object.hasOwn(query, 'limit');
  if (!hasPage && !hasLimit) return null;

  const rawPage = hasPage ? query.page : '1';
  const rawLimit = hasLimit ? query.limit : '10';
  if (typeof rawPage !== 'string' || !/^[1-9]\d*$/.test(rawPage)) {
    return { error: 'El parámetro page debe ser un entero positivo.' };
  }
  if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit) || !pageSizes.has(Number(rawLimit))) {
    return { error: 'El parámetro limit debe ser 10, 25 o 50.' };
  }

  const page = Number(rawPage);
  if (!Number.isSafeInteger(page)) {
    return { error: 'El parámetro page está fuera del rango permitido.' };
  }

  return { page, limit: Number(rawLimit) };
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
