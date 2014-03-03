rm ../fumo.nw
zip -r ../fumo.nw . -x .idea\* example\* node_modules/selenium-webdriver/lib/test\* node_modules/selenium-webdriver/test\* node_modules/selenium-webdriver/docs\*
open -n -a node-webkit ../fumo.nw



