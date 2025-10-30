import { vi } from "bun:test";

type InsertCall = {
  table: unknown;
  values: any;
  selection?: any;
};

type UpdateCall = {
  table: unknown;
  updates: any;
  condition: any;
  selection?: any;
};

type DeleteCall = {
  table: unknown;
  condition: any;
  selection?: any;
};

type SelectState = {
  from?: unknown;
  conditions: any[];
  orderings: any[];
  limit?: number;
  offset?: number;
};

function createQueryBuilder(resultRef: () => any): any {
  const state: SelectState = {
    conditions: [],
    orderings: [],
  };

  const build = {
    state,
    from(table: unknown) {
      state.from = table;
      return build;
    },
    where(condition: any) {
      state.conditions.push(condition);
      return build;
    },
    orderBy(ordering: any) {
      state.orderings.push(ordering);
      return build;
    },
    limit(value: number) {
      state.limit = value;
      return build;
    },
    offset(value: number) {
      state.offset = value;
      return build;
    },
    then<TResult1 = any, TResult2 = never>(
      onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(resultRef()).then(onfulfilled, onrejected);
    },
    catch<TResult = never>(
      onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
    ) {
      return Promise.resolve(resultRef()).catch(onrejected);
    },
    finally(onfinally?: (() => void) | null) {
      return Promise.resolve(resultRef()).finally(onfinally ?? undefined);
    },
    [Symbol.toStringTag]: "MockQueryBuilder",
  };

  return build;
}

export function createMockDb(initialSelectResult: any = []): any {
  let insertReturnValue: any[] = [];
  let updateReturnValue: any[] = [];
  let deleteReturnValue: any[] = [];
  let selectResult = initialSelectResult;

  const insertCalls: InsertCall[] = [];
  const updateCalls: UpdateCall[] = [];
  const deleteCalls: DeleteCall[] = [];
  const selectStates: SelectState[] = [];
  const runCalls: any[] = [];
  const allCalls: any[] = [];

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: any) => {
      const call: InsertCall = { table, values };
      insertCalls.push(call);
      return {
        returning: vi.fn((selection?: any) => {
          call.selection = selection;
          return Promise.resolve(insertReturnValue);
        }),
      };
    }),
  }));

  const update = vi.fn((table: unknown) => ({
    set: vi.fn((updates: any) => ({
      where: vi.fn((condition: any) => {
        const call: UpdateCall = { table, updates, condition };
        updateCalls.push(call);
        return {
          returning: vi.fn((selection?: any) => {
            call.selection = selection;
            return Promise.resolve(updateReturnValue);
          }),
        };
      }),
    })),
  }));

  const deleteFn = vi.fn((table: unknown) => ({
    where: vi.fn((condition: any) => {
      const call: DeleteCall = { table, condition };
      deleteCalls.push(call);
      return {
        returning: vi.fn((selection?: any) => {
          call.selection = selection;
          return Promise.resolve(deleteReturnValue);
        }),
      };
    }),
  }));

  const select = vi.fn(() => {
    const builder = createQueryBuilder(() => selectResult);
    selectStates.push(builder.state);
    return builder;
  });

  const run = vi.fn((statement: any) => {
    runCalls.push(statement);
  });

  const all = vi.fn((statement?: any) => {
    allCalls.push(statement);
    return selectResult;
  });

  return {
    insert,
    update,
    delete: deleteFn,
    select,
    run,
    all,
    setInsertReturnValue(value: any[]) {
      insertReturnValue = value;
    },
    setUpdateReturnValue(value: any[]) {
      updateReturnValue = value;
    },
    setDeleteReturnValue(value: any[]) {
      deleteReturnValue = value;
    },
    setSelectResult(value: any) {
      selectResult = value;
    },
    __calls: {
      insertCalls,
      updateCalls,
      deleteCalls,
      selectStates,
      runCalls,
      allCalls,
    },
  };
}
