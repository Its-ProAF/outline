import { CopyIcon, EyeIcon, PadlockIcon } from "outline-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import Modal from "~/components/Modal";
import Scene from "~/components/Scene";
import { client } from "~/utils/ApiClient";
import { LoginSecurity } from "./LoginSecurity";
import { PasswordCategory } from "../shared/schema";
import type {
  PasswordCategoryValue,
  PasswordEntry,
  PasswordValues,
} from "../shared/schema";

interface Page {
  entries: PasswordEntry[];
  total: number;
  canWrite: boolean;
}
const pageSize = 50;
const categories: Record<PasswordCategoryValue, string> = {
  password: "Password",
  key: "Chiavi",
  environment: "Variabili ambiente",
  file: "File e certificati",
};

/** Uses the saved site name, falling back to its hostname for older entries. */
function siteName(entry: PasswordEntry) {
  return entry.name || new URL(entry.site).hostname.replace(/^www\./, "");
}

/** Workspace credential table with explicit secret disclosure and editing. */
export function Passwords() {
  const [page, setPage] = useState<Page>();
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState<PasswordCategoryValue>("password");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PasswordEntry | "new">();
  const [deleting, setDeleting] = useState<PasswordEntry>();
  const [notes, setNotes] = useState<PasswordEntry>();
  const [security, setSecurity] = useState<PasswordEntry>();
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError("");
    try {
      const result = await client.post<{ data: Page }>("/passwords.list", {
        offset,
        limit: pageSize,
        category,
      });
      if (current === request.current) {
        setPage(result.data);
      }
    } catch {
      if (current === request.current) {
        setError("Impossibile caricare le password. Riprova.");
      }
    } finally {
      if (current === request.current) {
        setLoading(false);
      }
    }
  }, [offset, category]);
  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  const handleDelete = async () => {
    if (!deleting) {
      return;
    }
    setBusy(true);
    try {
      await client.post("/passwords.delete", {
        id: deleting.id,
        version: deleting.version,
      });
      setDeleting(undefined);
      if (page?.entries.length === 1 && offset > 0) {
        setOffset(offset - pageSize);
      } else {
        await load();
      }
    } catch {
      setError(
        "Eliminazione non riuscita. La voce potrebbe essere cambiata: aggiorna e riprova."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Scene icon={<PadlockIcon />} title="Password" wide>
      <Toolbar>
        <Heading>Password</Heading>
        <Actions>
          <Button neutral onClick={load} disabled={loading}>
            Aggiorna
          </Button>
          {page?.canWrite && (
            <Button onClick={() => setEditing("new")}>Nuova voce</Button>
          )}
        </Actions>
      </Toolbar>
      <CategoryBar aria-label="Tipo di credenziale">
        {PasswordCategory.options.map((value) => (
          <Button
            key={value}
            neutral={category !== value}
            aria-pressed={category === value}
            onClick={() => {
              if (category === value) {
                return;
              }
              request.current += 1;
              setPage(undefined);
              setLoading(true);
              setOffset(0);
              setCategory(value);
            }}
          >
            {categories[value]}
          </Button>
        ))}
      </CategoryBar>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Caricamento…</p>}
      {!loading && page?.total === 0 && (
        <Empty>Nessuna voce in questa sezione.</Empty>
      )}
      {page && page.entries.length > 0 && (
        <TableScroll aria-busy={loading}>
          <Table>
            <thead>
              <tr>
                <th scope="col">{category === "password" ? "Sito" : "Nome"}</th>
                <th scope="col">
                  {category === "password" ? "Username" : "Identificativo"}
                </th>
                <th scope="col">
                  {category === "password" ? "Password" : "Valore"}
                </th>
                <th scope="col">Note</th>
                <th scope="col">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <tr key={`${entry.id}:${entry.version}`}>
                  <td>
                    <SiteLink
                      href={entry.site}
                      title={entry.site}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      {siteName(entry)}
                    </SiteLink>
                  </td>
                  <td>
                    <CellText title={entry.username}>
                      {entry.username || "—"}
                    </CellText>
                  </td>
                  <td>
                    {entry.hasPassword === false ? (
                      "Non impostata"
                    ) : (
                      <Secret entry={entry} />
                    )}
                  </td>
                  <td>
                    {entry.notes ? (
                      <Button
                        neutral
                        aria-label={`Mostra note per ${siteName(entry)}`}
                        onClick={() => setNotes(entry)}
                      >
                        Note
                      </Button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <Actions>
                      {category === "password" && (
                        <Button
                          neutral
                          onClick={() => setSecurity(entry)}
                          aria-label={`2FA e passkey per ${siteName(entry)}`}
                        >
                          {entry.hasPasskey
                            ? "Passkey"
                            : entry.hasTotp
                              ? "2FA attiva"
                              : "2FA / Passkey"}
                        </Button>
                      )}
                      {page.canWrite && (
                        <>
                          <Button neutral onClick={() => setEditing(entry)}>
                            Modifica
                          </Button>
                          <Button
                            neutral
                            onClick={() => {
                              setError("");
                              setDeleting(entry);
                            }}
                          >
                            Elimina
                          </Button>
                        </>
                      )}
                    </Actions>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
      {page && page.total > pageSize && (
        <Toolbar>
          <span>
            {offset + 1}–{Math.min(offset + pageSize, page.total)} di{" "}
            {page.total}
          </span>
          <Actions>
            <Button
              neutral
              disabled={offset === 0 || loading}
              onClick={() => setOffset(offset - pageSize)}
            >
              Precedenti
            </Button>
            <Button
              neutral
              disabled={offset + pageSize >= page.total || loading}
              onClick={() => setOffset(offset + pageSize)}
            >
              Successive
            </Button>
          </Actions>
        </Toolbar>
      )}
      <Modal
        isOpen={!!security}
        title="Sicurezza del login"
        onRequestClose={() => setSecurity(undefined)}
      >
        {security ? (
          <LoginSecurity
            entry={security}
            canWrite={!!page?.canWrite}
            onChanged={() => {
              void load();
            }}
          />
        ) : null}
      </Modal>
      <Modal
        isOpen={!!notes}
        title={`Note · ${notes ? siteName(notes) : ""}`}
        onRequestClose={() => setNotes(undefined)}
      >
        <Notes>{notes?.notes}</Notes>
      </Modal>
      <Modal
        isOpen={!!editing}
        title={editing === "new" ? "Nuova voce" : "Modifica voce"}
        onRequestClose={() => setEditing(undefined)}
      >
        {editing ? (
          <Editor
            key={editing === "new" ? "new" : editing.id}
            entry={editing}
            category={category}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined);
              void load();
            }}
          />
        ) : null}
      </Modal>
      <Modal
        isOpen={!!deleting}
        title="Elimina password"
        onRequestClose={() => {
          if (!busy) {
            setDeleting(undefined);
          }
        }}
      >
        <p>
          Eliminare l’accesso a {deleting?.site} per{" "}
          {deleting?.username || "questo utente"}?
        </p>
        <p>La voce sarà rimossa definitivamente.</p>
        {error && <p role="alert">{error}</p>}
        <Actions>
          <Button
            neutral
            disabled={busy}
            onClick={() => setDeleting(undefined)}
          >
            Annulla
          </Button>
          <Button danger disabled={busy} onClick={handleDelete}>
            Elimina
          </Button>
        </Actions>
      </Modal>
    </Scene>
  );
}

interface SecretProps {
  entry: PasswordEntry;
}
/** Fetches secrets only on demand and clears disclosure on blur, hiding, or timeout. */
function Secret({ entry }: SecretProps) {
  const [secret, setSecret] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const clear = () => {
      generation.current += 1;
      setSecret(undefined);
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      generation.current += 1;
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  useEffect(() => {
    if (secret === undefined) {
      return;
    }
    const timer = window.setTimeout(() => setSecret(undefined), 30000);
    return () => window.clearTimeout(timer);
  }, [secret]);
  const handleRead = async (copy: boolean) => {
    const current = generation.current;
    setBusy(true);
    setMessage("");
    try {
      const result = await client.post<{ data: PasswordValues }>(
        "/passwords.info",
        { id: entry.id }
      );
      if (generation.current !== current) {
        return;
      }
      if (copy) {
        await navigator.clipboard.writeText(result.data.password);
        setMessage("Copiata");
      } else {
        setSecret(result.data.password);
      }
    } catch {
      setMessage("Operazione non riuscita. Riprova.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SecretCell>
      <code tabIndex={secret === undefined ? undefined : 0}>
        {secret ?? "••••••••"}
      </code>
      <Actions>
        <Button
          neutral
          icon={<EyeIcon />}
          title={secret === undefined ? "Mostra password" : "Nascondi password"}
          aria-pressed={secret !== undefined}
          disabled={busy}
          aria-label={`${secret === undefined ? "Mostra" : "Nascondi"} password per ${entry.site}`}
          onClick={() => {
            if (secret === undefined) {
              void handleRead(false);
            } else {
              setSecret(undefined);
            }
          }}
        />
        <Button
          neutral
          icon={<CopyIcon />}
          title="Copia password"
          disabled={busy}
          aria-label={`Copia password per ${entry.site}`}
          onClick={() => handleRead(true)}
        />
      </Actions>
      <SecretStatus role="status">{message}</SecretStatus>
    </SecretCell>
  );
}

interface EditorProps {
  entry: PasswordEntry | "new";
  category: PasswordCategoryValue;
  onClose: () => void;
  onSaved: () => void;
}
/** Edits metadata without fetching the existing secret; blank preserves it on update. */
function Editor({ entry, category, onClose, onSaved }: EditorProps) {
  const [values, setValues] = useState({
    category: entry === "new" ? category : (entry.category ?? "password"),
    name: entry === "new" ? "" : entry.name || "",
    loginUrl: entry === "new" ? "" : entry.loginUrl || "",
    site: entry === "new" ? "" : entry.site,
    username: entry === "new" ? "" : entry.username,
    password: "",
    notes: entry === "new" ? "" : entry.notes,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (entry === "new") {
        await client.post("/passwords.create", {
          ...values,
          loginUrl: values.loginUrl || null,
        });
      } else {
        const { password, ...metadata } = values;
        await client.post("/passwords.update", {
          id: entry.id,
          version: entry.version,
          ...metadata,
          loginUrl: values.loginUrl || null,
          ...(password ? { password } : {}),
        });
      }
      onSaved();
    } catch {
      setError(
        "Salvataggio non riuscito. Controlla il sito e, se la voce è cambiata, chiudi e aggiorna la tabella."
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Form onSubmit={handleSubmit}>
      <label>
        Tipo
        <Select
          value={values.category}
          onChange={(e) =>
            setValues({
              ...values,
              category: PasswordCategory.parse(e.target.value),
            })
          }
        >
          {PasswordCategory.options.map((value) => (
            <option key={value} value={value}>
              {categories[value]}
            </option>
          ))}
        </Select>
      </label>
      <label>
        {values.category === "password" ? "Nome del sito" : "Nome"}
        <Input
          autoFocus
          maxLength={200}
          placeholder="Ad esempio Gmail"
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
      </label>
      <label>
        {values.category === "password"
          ? "Link del sito"
          : "Link del servizio o del file"}
        <Input
          type="url"
          required
          maxLength={2048}
          placeholder="https://esempio.it"
          value={values.site}
          onChange={(e) => setValues({ ...values, site: e.target.value })}
        />
      </label>
      <label>
        Link di login (se diverso dal sito)
        <Input
          type="url"
          maxLength={2048}
          placeholder="https://accounts.google.com"
          value={values.loginUrl}
          onChange={(e) => setValues({ ...values, loginUrl: e.target.value })}
        />
      </label>
      <label>
        {values.category === "password" ? "Username" : "Identificativo"}
        <Input
          autoComplete="off"
          maxLength={1024}
          value={values.username}
          onChange={(e) => setValues({ ...values, username: e.target.value })}
        />
      </label>
      <label>
        {values.category === "password" ? "Password" : "Valore segreto"}
        <Input
          type="password"
          autoComplete="new-password"
          maxLength={16384}
          value={values.password}
          onChange={(e) => setValues({ ...values, password: e.target.value })}
        />
      </label>
      <small>
        {entry === "new"
          ? "Facoltativa per gli account che usano solo una passkey."
          : "Lascia vuoto per mantenere la password attuale."}
      </small>
      <label>
        Note
        <Textarea
          rows={4}
          maxLength={16384}
          value={values.notes}
          onChange={(e) => setValues({ ...values, notes: e.target.value })}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Actions>
        <Button neutral type="button" disabled={busy} onClick={onClose}>
          Annulla
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Salvataggio…" : "Salva"}
        </Button>
      </Actions>
    </Form>
  );
}

const Toolbar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin: 16px 0;
`;
const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
`;
const CategoryBar = styled.nav`
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 8px 0 16px;
  white-space: nowrap;
`;
const Empty = styled.p`
  padding: 48px 16px;
  text-align: center;
  color: ${s("textSecondary")};
`;
const TableScroll = styled.div`
  overflow-x: auto;
`;
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  th,
  td {
    padding: 8px 12px;
    border-bottom: 1px solid ${s("divider")};
    vertical-align: middle;
    white-space: nowrap;
  }
  th {
    color: ${s("textSecondary")};
    font-weight: 500;
  }
  td {
    max-width: 340px;
  }
`;
const CellText = styled.span`
  display: block;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const SiteLink = styled.a`
  display: block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const Notes = styled.div`
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 60vh;
  overflow-y: auto;
`;
const SecretCell = styled.div`
  display: flex;
  align-items: center;
  position: relative;
  gap: 8px;
  code {
    display: block;
    width: 100px;
    white-space: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
`;
const SecretStatus = styled.span`
  position: absolute;
  right: 0;
  bottom: 100%;
  background: ${s("background")};
  font-size: 12px;
`;
const Form = styled.form`
  display: grid;
  gap: 16px;
  label {
    display: grid;
    gap: 6px;
  }
`;
const Input = styled.input`
  width: 100%;
  padding: 8px 10px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  background: ${s("inputBackground")};
  color: ${s("text")};
  font: inherit;
`;
const Textarea = styled.textarea`
  width: 100%;
  padding: 8px 10px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  background: ${s("inputBackground")};
  color: ${s("text")};
  font: inherit;
  resize: vertical;
`;
const Select = styled.select`
  padding: 8px 10px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  background: ${s("inputBackground")};
  color: ${s("text")};
  font: inherit;
`;
