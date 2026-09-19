import styled from "styled-components";
import type { BoardData } from "../../shared/types";
import type { BoardFilter, FacetKey } from "../filters";
import {
  AreaOrder,
  countFor,
  CurrentYear,
  firstName,
  NoValue,
  TypeNames,
} from "../filters";

type Props = {
  board: BoardData;
  filter: BoardFilter;
  onChange: (filter: BoardFilter) => void;
  /** Facets the page decides on its own, like the year on the calendar. */
  omit?: FacetKey[];
};

type Group = { key: FacetKey; legend: string; options: [string, string][] };

export default function Facets({ board, filter, onChange, omit }: Props) {
  const me = board.viewer.login;
  const personName = (login: string) =>
    firstName(
      board.people.find((p) => p.login === login),
      login
    );
  const milestones = [
    ...new Set(
      board.issues.map((i) => i.milestone).filter((m): m is string => !!m)
    ),
  ].sort((a, b) => a.localeCompare(b));
  const years = [
    ...new Set(
      [CurrentYear, ...board.issues.map((i) => i.year)].filter(
        (y): y is string => !!y
      )
    ),
  ].sort();
  const areas = [
    ...new Set(board.issues.map((i) => i.area).filter(Boolean)),
  ].sort(
    (a, b) => rank(AreaOrder, a as string) - rank(AreaOrder, b as string)
  ) as string[];

  const groups: Group[] = [
    {
      key: "assignee",
      legend: "Responsabile",
      options: [
        ["", "Tutti"],
        ...(me ? [[me, `${personName(me)} (tu)`] as [string, string]] : []),
        ...board.people
          .filter((p) => p.login !== me)
          .map((p): [string, string] => [p.login, personName(p.login)]),
        [NoValue, "Senza responsabile"],
      ],
    },
    {
      key: "type",
      legend: "Tipo",
      options: [...Object.entries(TypeNames), ["", "Tutti"]],
    },
    {
      key: "milestone",
      legend: "Macro task",
      options: [
        ["", "Tutti"],
        ...milestones.map((m): [string, string] => [m, m]),
        [NoValue, "Senza macro task"],
      ],
    },
    {
      key: "year",
      legend: "Anno",
      options: [...years.map((y): [string, string] => [y, y]), ["", "Tutti"]],
    },
    {
      key: "area",
      legend: "Area",
      options: [
        ["", "Tutte"],
        ...areas.map((a): [string, string] => [
          a,
          a[0].toUpperCase() + a.slice(1),
        ]),
      ],
    },
  ];

  return (
    <Aside aria-label="Filtri">
      {groups
        .filter((group) => !omit?.includes(group.key))
        .map((group) => (
          <Fieldset key={group.key}>
            <Legend>{group.legend}</Legend>
            {group.options.map(([value, label]) => {
              const selected = filter[group.key] === value;
              return (
                <Option key={value} $selected={selected}>
                  <input
                    type="radio"
                    name={`board-${group.key}`}
                    checked={selected}
                    onChange={() => onChange({ ...filter, [group.key]: value })}
                  />
                  {label}
                  <Count>
                    {countFor(board.issues, filter, group.key, value)}
                  </Count>
                </Option>
              );
            })}
          </Fieldset>
        ))}
    </Aside>
  );
}

function rank(order: string[], value: string) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

const Aside = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 18px;
  position: sticky;
  top: 72px;

  @media (max-width: 1180px) {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 12px 22px;
  }
`;

const Fieldset = styled.fieldset`
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
`;

const Legend = styled.legend`
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${(props) => props.theme.textTertiary};
  font-weight: 600;
  margin-bottom: 4px;
  padding: 0;
`;

const Option = styled.label<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: 5px;
  cursor: var(--pointer);
  font-size: 14px;
  color: ${(props) =>
    props.$selected ? props.theme.text : props.theme.textSecondary};
  font-weight: ${(props) => (props.$selected ? 500 : 400)};

  &:hover {
    background: ${(props) => props.theme.listItemHoverBackground};
  }

  input {
    margin: 0;
    accent-color: ${(props) => props.theme.accent};
  }
`;

const Count = styled.span`
  margin-left: auto;
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
  font-variant-numeric: tabular-nums;
`;
