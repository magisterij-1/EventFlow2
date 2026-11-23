# Produkcijska namestitev EventFlowa

Job `build` iz produkcijskega frontenda in backenda sestavi sliko Docker za Linux AMD64. Job `deploy` po uspešnem `lint`, `test` in `build` ob pushu na `main` prenese to sliko iz istega zagona, jo objavi v GHCR in njen digest namesti na Render. Produkcijski frontend in API sta na istem javnem naslovu. Vite dobi `VITE_API_URL=/api`, `VITE_KEYCLOAK_URL` pa prevzame javni URL Keycloaka.

## Priprava Renderja

1. V isti regiji pripravi trajni bazi Render Postgres za aplikacijo in Keycloak. Uporabi notranja naslova baz. Ob zagonu aplikacijska slika izvede `backend/database/schema.sql` in doda privzete kategorije. Obstoječe tabele in podatki se ohranijo.
2. Ustvari javno slikovno storitev za Keycloak. Zaženi jo z ukazom `start` in nastavi `KC_HTTP_ENABLED=true`, `KC_PROXY_HEADERS=xforwarded`, `KC_HOSTNAME` na dejanski javni naslov HTTPS ter `KC_DB=postgres`. Za bazo Keycloak nastavi `KC_DB_URL` na njen notranji naslov JDBC, `KC_DB_USERNAME` in `KC_DB_PASSWORD` pa na podatke te baze. Za prvi zagon v Renderju nastavi `KC_BOOTSTRAP_ADMIN_USERNAME` in `KC_BOOTSTRAP_ADMIN_PASSWORD`.
3. V Keycloaku ustvari realm `EventFlow`, odjemalca `eventflow-frontend` in `eventflow-backend` ter vloge po navodilih za [lokalno nastavitev](../README.md#5-začetna-nastavitev-keycloaka). Za produkcijo uporabi privzeto prijavno temo. Pri frontend odjemalcu uporabi dejanski javni naslov aplikacije v **Valid redirect URIs** (`https://<aplikacija>.onrender.com/*`), **Valid post logout redirect URIs** in **Web origins** (`https://<aplikacija>.onrender.com`). Backendu dodeli servisni račun z vlogama `realm-management` `manage-users` in `view-realm`.
4. V nastavitvah Render delovnega prostora dodaj poverilnico za GHCR z žetonom, ki ima `read:packages` za sliko forka. Render s to poverilnico prenese zasebno sliko. GitHub Actions za objavo slike uporabi vgrajeni `GITHUB_TOKEN`.

Dokumentacija ponudnikov je na voljo v navodilih za [slike Render](https://render.com/docs/deploying-an-image) in [Keycloak za obratnim posrednikom](https://www.keycloak.org/server/reverseproxy).

## Nastavitve GitHuba

V **Settings → Secrets and variables → Actions → Variables** dodaj repozitorijsko spremenljivko `PRODUCTION_KEYCLOAK_URL`, ker jo potrebuje že `build`.

V **Settings → Environments → production** dodaj naslednje skrivnosti:

| Skrivnost | Vrednost |
| --- | --- |
| `RENDER_API_KEY` | Ključ Render API z dostopom za branje in namestitev storitev. |
| `DATABASE_URL` | Notranji povezovalni URL baze EventFlow. |
| `KEYCLOAK_BACKEND_CLIENT_SECRET` | Skrivnost odjemalca `eventflow-backend`. |

V istem okolju dodaj spremenljivki `RENDER_OWNER_ID` in `RENDER_REGISTRY_CREDENTIAL_ID`. Po potrebi lahko nastaviš `RENDER_SERVICE_NAME` (privzeto `eventflow-production`), `RENDER_REGION` (privzeto `frankfurt`, naj se ujema z bazo) in `RENDER_PLAN` (privzeto `free`).

Pri prvem deployu workflow ustvari slikovno spletno storitev in prenese konfiguracijo backenda v Render. Pri poznejši rotaciji produkcijskih skrivnosti jih posodobi tako v GitHub okolju kot v nastavitvah te storitve. Če Render ob prvem zagonu dodeli drug javni naslov, ga dodaj v Keycloak in znova zaženi neuspešni job istega pusha. Workflow objavi javni URL po preverjanju frontenda, odgovora API-ja in preusmeritve ob prijavi.
