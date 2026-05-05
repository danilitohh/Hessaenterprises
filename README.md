# Hessa Follow Up Web

Aplicacion web en `React + TypeScript` para gestionar clientes y llevar seguimiento comercial con una secuencia de contactos programados.

## Que hace

- Registra clientes con nombre, correo, empresa y notas.
- Define la cantidad de intentos que cada usuario quiera usar por seguimiento.
- Guarda clientes, reglas y plantillas en `localStorage` del navegador.
- Abre cada correo como borrador en el cliente de correo predeterminado del usuario.
- Reprograma automaticamente el siguiente contacto segun el intervalo configurado.
- Finaliza el flujo cuando el cliente completa todos sus intentos.

## Como correrla

```bash
npm install
npm run dev
```

## Supabase Auth

La app usa Supabase Auth para registro, inicio de sesion, Google OAuth y recuperacion de contrasena.

La configuracion de auth ya esta funcionando y esta protegida por un candado de build. Antes de cambiar URLs, claves o providers, lee `AUTH_LOCK.md`.

Proyecto Supabase actual:

```bash
VITE_SUPABASE_URL=https://eaocwrgbqeakyycmtbah.supabase.co
VITE_SUPABASE_ANON_KEY=tu-publishable-o-anon-public-key
```

No uses `/rest/v1/` al final de `VITE_SUPABASE_URL`.

URLs requeridas en Supabase `Authentication > URL Configuration`:

- `Site URL`: `https://hessaenterprises.vercel.app`
- `Redirect URLs`: `https://hessaenterprises.vercel.app`, `https://hessaenterprises.vercel.app/**`

Google OAuth debe usar el callback de Supabase:

- `https://eaocwrgbqeakyycmtbah.supabase.co/auth/v1/callback`

Nunca pongas el Google client secret en el frontend. Ese secreto solo va en Supabase `Authentication > Sign In / Providers > Google`.

Para validar el candado de auth:

```bash
npm run check:auth-config
```

## Gmail Sending

La app incluye una integracion para que cada usuario conecte Gmail y los follow-ups puedan enviarse desde su propia cuenta.

El flujo seguro usa OAuth + Supabase Edge Functions. Si Gmail no esta conectado, la app mantiene el comportamiento actual y abre el borrador con `mailto:`.

Consulta `GMAIL_INTEGRATION.md` antes de desplegar o cambiar esta integracion.

## SaaS readiness

La app ya tiene una capa progresiva para operar como SaaS multi-tenant:

- Roles preparados: `super_admin`, `owner`, `admin`, `staff`, `viewer`.
- Cada sesion queda asociada a un `account_id`.
- La UI separa datos por cuenta en el workspace actual.
- El panel maestro esta disponible en `/admin` y `/super-admin` para usuarios `super_admin`.
- Los planes y estados de suscripcion ya existen como estructura: `free`, `basic`, `pro`, `business`; `free`, `trial`, `active`, `past_due`, `cancelled`, `suspended`.
- Los super admins maestros configurados son `kevin.hessam@gmail.com` y `danilitohhh@gmail.com`.
- La base queda preparada para pagos futuros con campos de proveedor, cliente y suscripcion de billing.
- El super admin puede preparar precios mensuales/anuales y descuentos por plan desde `/admin`; se guardan como configuracion futura y no cobran nada todavia.
- No hay pagos activos todavia.

Para seguridad multi-tenant real en Supabase, aplica la migracion:

```bash
supabase db push
```

La migracion `supabase/migrations/202605050001_saas_multi_tenant.sql` crea `accounts`, `account_users`, campos de monetizacion futura, tablas base para appointments/proposals/follow-ups/templates, `account_id` en registros de Gmail y politicas RLS.

Para que el super admin vea absolutamente todos los usuarios registrados en Supabase Auth, despliega tambien:

```bash
supabase functions deploy admin-platform-state
```

Esa funcion usa service-role en Supabase, valida que el usuario sea `kevin.hessam@gmail.com` o `danilitohhh@gmail.com`, y devuelve la lista completa de `auth.users` al panel `/admin`.

## Build

```bash
npm run build
npm run preview
```

## Configuracion web

Desde la interfaz puedes configurar:

- `Correo de referencia`
- `Nombre visible`
- `Intervalo entre contactos`
- `Apertura automatica del primer borrador`
- `Asunto y cuerpo de la plantilla`

Tokens disponibles dentro de la plantilla:

- `{{name}}`
- `{{company}}`
- `{{companyOrName}}`
- `{{contactNumber}}`
- `{{maxContacts}}`
- `{{fromName}}`
- `{{fromEmail}}`
- `{{notes}}`
- `{{scheduledDate}}`
- `{{scheduledTime}}`

## Flujo de seguimiento

1. Se crea un cliente.
2. La app deja listo el contacto 1 para su horario programado.
3. Cuando abres el borrador de un intento, se agenda el siguiente contacto.
4. Cuando se completan todos los intentos, el cliente pasa a estado `finalizado`.

## Alcance actual

- Esta version no envia correos automaticamente desde un servidor.
- Los borradores se abren usando `mailto:` en el cliente de correo del usuario.
- Si luego quieres envio automatico real desde la web, necesitaremos agregar un backend o integrar un proveedor de correo.

## Validacion realizada

- `npm run lint`
- `npm run build`
