# Commands are run in a specific order so that commands that result in the most frequent changes are done last.
# This reduces the deploy payload.
FROM node:6.9.2

# Make the app run in production mode.
ENV NODE_ENV production

# Define primary working directory.
WORKDIR /app

# Install dependencies in production mode (no dev dependencies).
COPY package.json /app/
RUN npm install --production --quiet

COPY src /app/src/

CMD ["node","src/app.js"]
