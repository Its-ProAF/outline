import { parseDeadline } from "../../board/shared/columns";
import { bodyWithDeadline, changeForSchedule } from "./schedule";

describe("bodyWithDeadline", () => {
  it("replaces the date without touching the rest", () => {
    expect(
      bodyWithDeadline("Scadenza: 2026-09-30\n\nContesto.", "2026-10-15")
    ).toBe("Scadenza: 2026-10-15\n\nContesto.");
  });

  it("puts the deadline on top when the issue has none", () => {
    expect(bodyWithDeadline("Contesto.", "2026-10-15")).toBe(
      "Scadenza: 2026-10-15\n\nContesto."
    );
  });

  it("writes the only line of an empty body", () => {
    expect(bodyWithDeadline(null, "2026-10-15")).toBe("Scadenza: 2026-10-15");
    expect(bodyWithDeadline("   ", "2026-10-15")).toBe("Scadenza: 2026-10-15");
  });

  it("keeps the CRLF of a body written on GitHub", () => {
    expect(bodyWithDeadline("Contesto.\r\nAltro.", "2026-10-15")).toBe(
      "Scadenza: 2026-10-15\r\n\r\nContesto.\r\nAltro."
    );
  });

  it("takes the line and its blank line away", () => {
    expect(bodyWithDeadline("Scadenza: 2026-09-30\n\nContesto.", null)).toBe(
      "Contesto."
    );
    expect(
      bodyWithDeadline("Scadenza: 2026-09-30\r\n\r\nContesto.", null)
    ).toBe("Contesto.");
    expect(bodyWithDeadline("Scadenza: 2026-09-30", null)).toBe("");
  });

  it("leaves a body without a deadline alone", () => {
    expect(bodyWithDeadline("Contesto.", null)).toBe("Contesto.");
  });

  it("replaces a deadline written in the middle of the body", () => {
    expect(
      bodyWithDeadline("Contesto.\n\nScadenza: 2026-09-30\n", "2026-10-15")
    ).toBe("Contesto.\n\nScadenza: 2026-10-15\n");
  });

  it("writes what the board reads back", () => {
    const body = bodyWithDeadline("Contesto.", "2027-04-30");
    expect(parseDeadline(body)).toBe("2027-04-30");
    expect(parseDeadline(bodyWithDeadline(body, null))).toBeNull();
  });
});

describe("changeForSchedule", () => {
  const issue = {
    body: "Scadenza: 2026-09-30\n\nContesto.",
    labels: ["area:fisco", "anno:2026"],
    deadline: "2026-09-30",
  };

  it("does nothing when the deadline is already that day", () => {
    expect(changeForSchedule(issue, "2026-09-30")).toBeUndefined();
    expect(
      changeForSchedule({ ...issue, body: "Contesto.", deadline: null }, null)
    ).toBeUndefined();
  });

  it("writes only the body while the year stays the same", () => {
    expect(changeForSchedule(issue, "2026-10-15")).toEqual({
      body: "Scadenza: 2026-10-15\n\nContesto.",
    });
  });

  it("moves the anno: label to the year of the new deadline", () => {
    expect(changeForSchedule(issue, "2027-04-30")).toEqual({
      body: "Scadenza: 2027-04-30\n\nContesto.",
      labels: ["area:fisco", "anno:2027"],
    });
  });

  it("gives an anno: label to an issue that had none", () => {
    expect(
      changeForSchedule(
        { body: "Contesto.", labels: ["area:fisco"], deadline: null },
        "2027-04-30"
      )
    ).toEqual({
      body: "Scadenza: 2027-04-30\n\nContesto.",
      labels: ["area:fisco", "anno:2027"],
    });
  });

  it("collapses more than one anno: label into the right one", () => {
    expect(
      changeForSchedule(
        { ...issue, labels: ["anno:2026", "anno:2027"] },
        "2026-10-15"
      )
    ).toEqual({
      body: "Scadenza: 2026-10-15\n\nContesto.",
      labels: ["anno:2026"],
    });
  });

  it("leaves the year alone when the deadline goes away", () => {
    expect(changeForSchedule(issue, null)).toEqual({ body: "Contesto." });
  });
});
