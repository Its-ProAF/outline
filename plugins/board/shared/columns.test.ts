import {
  BoardColumn,
  changeForMove,
  columnFor,
  labelValue,
  parseDeadline,
} from "./columns";

describe("columnFor", () => {
  it("puts open issues without a stato: label in Da fare", () => {
    expect(columnFor({ state: "open", labels: ["area:fisco"] })).toBe(
      BoardColumn.Todo
    );
  });

  it("maps stato:in-corso to In corso", () => {
    expect(
      columnFor({ state: "open", labels: ["area:fisco", "stato:in-corso"] })
    ).toBe(BoardColumn.Doing);
  });

  it("maps stato:in-attesa to In attesa", () => {
    expect(columnFor({ state: "open", labels: ["stato:in-attesa"] })).toBe(
      BoardColumn.Waiting
    );
  });

  it("puts closed issues in Fatto whatever their labels", () => {
    expect(columnFor({ state: "closed", labels: ["stato:in-corso"] })).toBe(
      BoardColumn.Done
    );
  });
});

describe("changeForMove", () => {
  it("adds the label when moving from Da fare to In corso", () => {
    expect(
      changeForMove(
        { state: "open", labels: ["area:fisco"] },
        BoardColumn.Doing
      )
    ).toEqual({ labels: ["area:fisco", "stato:in-corso"] });
  });

  it("swaps the stato: label between In corso and In attesa", () => {
    expect(
      changeForMove(
        { state: "open", labels: ["stato:in-corso", "tipo:attività"] },
        BoardColumn.Waiting
      )
    ).toEqual({ labels: ["tipo:attività", "stato:in-attesa"] });
  });

  it("removes the stato: label when moving back to Da fare", () => {
    expect(
      changeForMove(
        { state: "open", labels: ["stato:in-attesa"] },
        BoardColumn.Todo
      )
    ).toEqual({ labels: [] });
  });

  it("closes as completed and drops the stato: label when moving to Fatto", () => {
    expect(
      changeForMove(
        { state: "open", labels: ["area:agenti", "stato:in-corso"] },
        BoardColumn.Done
      )
    ).toEqual({
      labels: ["area:agenti"],
      state: "closed",
      stateReason: "completed",
    });
  });

  it("closes without touching labels when there is no stato: label", () => {
    expect(
      changeForMove(
        { state: "open", labels: ["area:agenti"] },
        BoardColumn.Done
      )
    ).toEqual({ state: "closed", stateReason: "completed" });
  });

  it("reopens when moving out of Fatto", () => {
    expect(
      changeForMove({ state: "closed", labels: [] }, BoardColumn.Todo)
    ).toEqual({ state: "open", stateReason: "reopened" });
    expect(
      changeForMove(
        { state: "closed", labels: ["area:fisco"] },
        BoardColumn.Doing
      )
    ).toEqual({
      labels: ["area:fisco", "stato:in-corso"],
      state: "open",
      stateReason: "reopened",
    });
  });

  it("returns nothing when the issue is already in the column", () => {
    expect(
      changeForMove(
        { state: "open", labels: ["stato:in-corso"] },
        BoardColumn.Doing
      )
    ).toBeUndefined();
  });
});

describe("parseDeadline", () => {
  it("reads the Scadenza line", () => {
    expect(parseDeadline("Scadenza: 2026-09-29\n\nContesto.")).toBe(
      "2026-09-29"
    );
  });

  it("returns null without a valid line", () => {
    expect(parseDeadline("Contesto senza scadenza")).toBeNull();
    expect(parseDeadline(null)).toBeNull();
  });
});

describe("labelValue", () => {
  it("returns the value after the prefix", () => {
    expect(labelValue(["tipo:sviluppo", "area:agenti"], "area:")).toBe(
      "agenti"
    );
    expect(labelValue(["tipo:sviluppo"], "area:")).toBeNull();
  });
});
