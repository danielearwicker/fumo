tsc --noImplicitAny --module commonjs index.ts
rm ../fumo.nw
zip -r ../fumo.nw . -x .idea\* example\* node_modules/selenium-webdriver/lib/test\* node_modules/selenium-webdriver/test\* node_modules/selenium-webdriver/docs\*
cp ../fumo.nw ../../TFS/trunk/UiTests/
