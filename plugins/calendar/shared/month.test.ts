import { isoDate, monthOf, monthTitle, shiftMonth, weeksOf } from "./month";

describe("isoDate", () => {
  it("formats the local day, not the UTC one", () => {
    expect(isoDate(new Date(2026, 8, 1, 0, 30))).toBe("2026-09-01");
    expect(isoDate(new Date(2026, 8, 30, 23, 30))).toBe("2026-09-30");
  });
});

describe("shiftMonth", () => {
  it("crosses the end of the year in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });

  it("moves by more than a year", () => {
    expect(shiftMonth("2026-09", 14)).toBe("2027-11");
  });
});

describe("monthOf", () => {
  it("takes the month of a day", () => {
    expect(monthOf("2027-04-30")).toBe("2027-04");
  });
});

describe("monthTitle", () => {
  it("names the month in Italian", () => {
    expect(monthTitle("2026-09")).toBe("settembre 2026");
  });
});

describe("weeksOf", () => {
  it("starts every week on Monday", () => {
    for (const week of weeksOf("2026-09")) {
      expect(week).toHaveLength(7);
      expect(new Date(`${week[0].date}T12:00`).getDay()).toBe(1);
      expect(new Date(`${week[6].date}T12:00`).getDay()).toBe(0);
    }
  });

  it("fills the first and last week with the neighbouring months", () => {
    const weeks = weeksOf("2026-09");

    // September 2026 begins on a Tuesday and ends on a Wednesday.
    expect(weeks[0][0]).toEqual({ date: "2026-08-31", inMonth: false });
    expect(weeks[0][1]).toEqual({ date: "2026-09-01", inMonth: true });
    const last = weeks[weeks.length - 1];
    expect(last[2]).toEqual({ date: "2026-09-30", inMonth: true });
    expect(last[3]).toEqual({ date: "2026-10-01", inMonth: false });
  });

  it("holds every day of the month once", () => {
    const days = weeksOf("2027-02")
      .flat()
      .filter((day) => day.inMonth)
      .map((day) => day.date);

    expect(days).toHaveLength(28);
    expect(days[0]).toBe("2027-02-01");
    expect(days[27]).toBe("2027-02-28");
  });

  it("uses six weeks when the month needs them", () => {
    // August 2026 begins on a Saturday and has 31 days.
    expect(weeksOf("2026-08")).toHaveLength(6);
    expect(weeksOf("2026-09")).toHaveLength(5);
  });

  it("counts the leap day", () => {
    expect(
      weeksOf("2028-02")
        .flat()
        .filter((day) => day.inMonth)
    ).toHaveLength(29);
  });
});
