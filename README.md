# Hessa Follow Up Web

Aplicacion web en `React + TypeScript` para gestionar clientes y llevar seguimiento comercial con una secuencia de contactos programados.

## Que hace

- Registra clientes con nombre, correo, empresa y notas.
- Define hasta 4 contactos por cliente con hora especifica por intento.
- Guarda clientes, reglas y plantillas en `localStorage` del navegador.
- Abre cada correo como borrador en el cliente de correo predeterminado del usuario.
- Reprograma automaticamente el siguiente contacto segun el intervalo configurado.
- Finaliza el flujo cuando el cliente completa todos sus intentos.

## Como correrla

```bash
npm install
npm run dev
```

## Acceso con Gmail / Google

Para activar el boton de acceso con Google:

1. Crea un OAuth Client ID de tipo `Web application` en Google Cloud.
2. Agrega tus origenes autorizados, por ejemplo `http://localhost:5173` para desarrollo.
3. Crea un archivo `.env.local` basado en `.env.example`.
4. Reinicia el servidor de Vite.

```bash
VITE_GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
```

El acceso con Google crea automaticamente el usuario la primera vez y luego reutiliza el mismo workspace local.

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
