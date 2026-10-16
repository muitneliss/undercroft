/**
 * What an object grant names, in a reader's words, and the grant form's options for one (ADR
 * 0142). The options are gathered by `useGrantObjects`, from the server's own lists.
 */

import { type Permission, parseReachObject } from "@undercroft/contracts/access";
import { useTranslation } from "react-i18next";

import { PermissionWords } from "@/components/RoleForms.tsx";
import type { GrantObjects } from "@/components/useGrantObjects.ts";

/** The form's object options, one group a kind; a kind with nothing to offer is left out. */
export function ObjectOptionGroups({ objects }: { objects: GrantObjects }): React.JSX.Element {
  const { t } = useTranslation();
  const groups = [
    { key: "whole", label: t("grantObjects.wholeGroup"), options: objects.whole },
    { key: "models", label: t("grantObjects.modelsGroup"), options: objects.models },
    { key: "streams", label: t("grantObjects.streamsGroup"), options: objects.streams },
    { key: "reports", label: t("grantObjects.reportsGroup"), options: objects.reports },
  ].filter((group) => group.options.length > 0);
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group.key} label={group.label}>
          {group.options.map((option) => (
            <option key={option.object} value={option.object}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/**
 * What an object grant gives, in words, then the object as it is spelled -- which is what a person
 * quotes. `null` for an object the grammar does not read, which the caller words as unknown.
 */
export function ObjectWords({
  object,
  names,
}: {
  object: string;
  names: ReadonlyMap<string, string>;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const read = parseReachObject(object);
  if (read === null) {
    return null;
  }
  let words: string;
  if (read.domain === "model") {
    words =
      read.name === null
        ? t("grantObjects.everyModel")
        : t("grantObjects.model", { name: read.name });
  } else if (read.domain === "raw") {
    if (read.source === null) {
      words = t("grantObjects.wholeLake");
    } else if (read.entity === null) {
      words = t("grantObjects.wholeSource", { source: read.source });
    } else {
      words = t("grantObjects.stream", { source: read.source, entity: read.entity });
    }
  } else if (read.report === null) {
    words = t("grantObjects.everyReport");
  } else {
    words =
      names.get(object) ??
      t(
        read.report.kind === "question"
          ? "grantObjects.questionGone"
          : "grantObjects.dashboardGone",
      );
  }
  return (
    <span className="stack stack--tight">
      <span>{words}</span>
      <span className="datum datum--quiet">{object}</span>
    </span>
  );
}

/**
 * What one grant gives, as the Grants table prints it: a permission in words, an object in
 * words, or -- for an object neither the catalogue nor the grammar reads, a permission since
 * retired -- that it holds nothing.
 */
export function GrantGives({
  grant,
  names,
}: {
  grant: { readonly permission: Permission | null; readonly object: string };
  names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (grant.permission !== null) {
    return <PermissionWords permission={grant.permission} />;
  }
  if (parseReachObject(grant.object) === null) {
    return <>{t("accessGrants.unknownPermission", { object: grant.object })}</>;
  }
  return <ObjectWords object={grant.object} names={names} />;
}
