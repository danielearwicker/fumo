tsc --noImplicitAny --module commonjs index.ts fumo.d.ts lib/node.d.ts lib/selenium-webdriver.d.ts lib/knockout.d.ts lib/stacktrace.d.ts
rm ../fumo.nw
zip -r ../fumo.nw . -x .idea\* example\* node_modules/typescript node_modules/selenium-webdriver/lib/test\* node_modules/selenium-webdriver/test\* node_modules/selenium-webdriver/docs\* > /dev/null
cp fumo.d.ts ../fumo.d.ts 
cat fumo-globals.d.ts >> ../fumo.d.ts
